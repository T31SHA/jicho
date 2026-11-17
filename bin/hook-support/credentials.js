'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SERVICE = 'org.jicho.desktop.hook-auth.v1';
const WINDOWS_TARGET = 'Jicho/HookAuth/v1/';
const WINDOWS_CREDENTIAL_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class JichoCredentialApi {
  [StructLayout(LayoutKind.Sequential)] public struct FILETIME { public uint low; public uint high; }
  [StructLayout(LayoutKind.Sequential)] public struct CREDENTIAL {
    public uint Flags; public uint Type; public IntPtr TargetName; public IntPtr Comment;
    public FILETIME LastWritten; public uint CredentialBlobSize; public IntPtr CredentialBlob;
    public uint Persist; public uint AttributeCount; public IntPtr Attributes;
    public IntPtr TargetAlias; public IntPtr UserName;
  }
  [DllImport("Advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool CredWrite(ref CREDENTIAL credential, uint flags);
  [DllImport("Advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool CredRead(string target, uint type, uint flags, out IntPtr credential);
  [DllImport("Advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool CredDelete(string target, uint type, uint flags);
  [DllImport("Advapi32.dll")] static extern void CredFree(IntPtr buffer);
  public static void Write(string target, string value) {
    byte[] blob = Encoding.UTF8.GetBytes(value);
    IntPtr targetPtr = Marshal.StringToCoTaskMemUni(target);
    IntPtr userPtr = Marshal.StringToCoTaskMemUni("Jicho");
    IntPtr blobPtr = Marshal.AllocCoTaskMem(blob.Length);
    try {
      Marshal.Copy(blob, 0, blobPtr, blob.Length);
      CREDENTIAL credential = new CREDENTIAL();
      credential.Type = 1; credential.TargetName = targetPtr; credential.UserName = userPtr;
      credential.CredentialBlobSize = (uint)blob.Length; credential.CredentialBlob = blobPtr;
      credential.Persist = 2;
      if (!CredWrite(ref credential, 0)) throw new Exception("CredWrite failed");
    } finally { Marshal.FreeCoTaskMem(targetPtr); Marshal.FreeCoTaskMem(userPtr); Marshal.FreeCoTaskMem(blobPtr); }
  }
  public static string Read(string target) {
    IntPtr pointer;
    if (!CredRead(target, 1, 0, out pointer)) {
      if (Marshal.GetLastWin32Error() == 1168) return "";
      throw new Exception("CredRead failed");
    }
    try {
      CREDENTIAL credential = (CREDENTIAL)Marshal.PtrToStructure(pointer, typeof(CREDENTIAL));
      byte[] blob = new byte[credential.CredentialBlobSize];
      if (blob.Length > 0) Marshal.Copy(credential.CredentialBlob, blob, 0, blob.Length);
      return Encoding.UTF8.GetString(blob);
    } finally { CredFree(pointer); }
  }
  public static void Delete(string target) {
    if (!CredDelete(target, 1, 0) && Marshal.GetLastWin32Error() != 1168) throw new Exception("CredDelete failed");
  }
}
'@
$op = $env:JICHO_CREDENTIAL_OPERATION
$target = $env:JICHO_CREDENTIAL_TARGET
if ($op -eq 'write') { [JichoCredentialApi]::Write($target, [Console]::In.ReadToEnd()) }
elseif ($op -eq 'read') { [Console]::Out.Write([JichoCredentialApi]::Read($target)) }
elseif ($op -eq 'delete') { [JichoCredentialApi]::Delete($target) }
else { exit 2 }
`;

function defaultDirectory(home = os.homedir(), env = process.env, platform = process.platform) {
  if (env.JICHO_CREDENTIAL_DIR) return path.resolve(env.JICHO_CREDENTIAL_DIR);
  if (platform === 'win32') return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Jicho');
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Jicho');
  return path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'jicho');
}

function commandAvailable(command, args = ['--version']) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true, timeout: 3000 });
  return !result.error || result.error.code !== 'ENOENT';
}

function encodeCredential(record) {
  return Buffer.from(JSON.stringify(record), 'utf8').toString('base64url');
}

function decodeCredential(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,4096}$/.test(value)) return null;
  try {
    const record = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!record || record.version !== 1 || !isUuid(record.installationId) || !isUuid(record.generation) ||
        typeof record.key !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(record.key)) return null;
    const key = Buffer.from(record.key, 'base64url');
    if (key.length !== 32) return null;
    return { version: 1, installationId: record.installationId, generation: record.generation, key, createdAt: record.createdAt };
  } catch (_) { return null; }
}

function isUuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function privateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') fs.chmodSync(directory, 0o700);
}

function readPrivateJson(file) {
  let info;
  try { info = fs.lstatSync(file); }
  catch (error) { if (error.code === 'ENOENT') return null; throw new Error('Jicho credential state is unavailable.'); }
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Jicho credential state is unsafe.');
  if (process.platform !== 'win32' && ((info.mode & 0o077) !== 0 || (typeof process.getuid === 'function' && info.uid !== process.getuid()))) {
    throw new Error('Jicho credential state permissions are unsafe.');
  }
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { throw new Error('Jicho credential state is invalid.'); }
}

function atomicPrivateWrite(file, contents) {
  privateDirectory(path.dirname(file));
  const temporary = path.join(path.dirname(file), '.' + path.basename(file) + '-' + crypto.randomBytes(8).toString('hex'));
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(descriptor, contents, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.renameSync(temporary, file);
    if (process.platform !== 'win32') fs.chmodSync(file, 0o600);
  } catch (error) {
    if (descriptor !== undefined && descriptor !== null) { try { fs.closeSync(descriptor); } catch (_) {} }
    try { fs.unlinkSync(temporary); } catch (_) {}
    throw error;
  }
}

class CredentialManager {
  constructor(options = {}) {
    this.platform = options.platform || process.platform;
    this.directory = options.directory || defaultDirectory(options.home, options.env || process.env, this.platform);
    this.stateFile = path.join(this.directory, 'hook-auth-state.json');
    this.cacheKey = null;
    this.cacheValue = null;
    this.forceFileStore = options.forceFileStore === true;
  }

  state() {
    const value = readPrivateJson(this.stateFile);
    if (value === null) return null;
    if (!value || value.version !== 1 || !isUuid(value.installationId) || !isUuid(value.generation) ||
        !['active', 'revoked'].includes(value.status) || typeof value.storage !== 'string') {
      throw new Error('Jicho credential state is invalid.');
    }
    return value;
  }

  nativeStorage() {
    if (this.forceFileStore) return null;
    if (this.platform === 'linux' && commandAvailable('secret-tool')) return 'linux-secret-service';
    if (this.platform === 'darwin' && commandAvailable('/usr/bin/security', ['help'])) return 'macos-keychain';
    if (this.platform === 'win32' && commandAvailable('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()'])) return 'windows-credential-manager';
    return null;
  }

  windowsPowerShell(operation, generation, input = '') {
    const encodedCommand = Buffer.from(WINDOWS_CREDENTIAL_SCRIPT, 'utf16le').toString('base64');
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodedCommand], {
      encoding: 'utf8', input, windowsHide: true, timeout: 5000,
      env: { ...process.env, JICHO_CREDENTIAL_OPERATION: operation, JICHO_CREDENTIAL_TARGET: WINDOWS_TARGET + generation }
    });
    if (result.error || result.status !== 0) throw new Error('Windows Credential Manager operation failed.');
    return result.stdout || '';
  }

  storeNative(storage, operation, generation, value = '') {
    if (storage === 'linux-secret-service') {
      const args = operation === 'write'
        ? ['store', '--label=Jicho Claude hook authentication', 'application', 'jicho', 'generation', generation]
        : operation === 'read'
          ? ['lookup', 'application', 'jicho', 'generation', generation]
          : ['clear', 'application', 'jicho', 'generation', generation];
      const result = spawnSync('secret-tool', args, { encoding: 'utf8', input: operation === 'write' ? value : undefined, windowsHide: true, timeout: 5000 });
      if (result.error || result.status !== 0) throw new Error('Linux Secret Service operation failed.');
      return (result.stdout || '').trim();
    }
    if (storage === 'macos-keychain') {
      const args = operation === 'read'
        ? ['find-generic-password', '-a', generation, '-s', SERVICE, '-w']
        : operation === 'delete'
          ? ['delete-generic-password', '-a', generation, '-s', SERVICE]
          : ['-i'];
      const input = operation === 'write'
        ? 'add-generic-password -U -a "' + generation + '" -s "' + SERVICE + '" -w "' + value + '"\n'
        : undefined;
      const result = spawnSync('/usr/bin/security', args, { encoding: 'utf8', input, windowsHide: true, timeout: 5000 });
      if (result.error || result.status !== 0) throw new Error('macOS Keychain operation failed.');
      return (result.stdout || '').trim();
    }
    if (storage === 'windows-credential-manager') return this.windowsPowerShell(operation, generation, value).trim();
    throw new Error('Unsupported Jicho credential store.');
  }

  fileFor(generation) { return path.join(this.directory, 'hook-credential-' + generation + '.json'); }

  writeRecord(storage, record) {
    const encoded = encodeCredential(record);
    if (storage === 'private-file') {
      atomicPrivateWrite(this.fileFor(record.generation), JSON.stringify({ encoded }) + '\n');
      return;
    }
    this.storeNative(storage, 'write', record.generation, encoded);
  }

  readRecord(state) {
    let encoded;
    if (state.storage === 'private-file') {
      const data = readPrivateJson(this.fileFor(state.generation));
      encoded = data && data.encoded;
    } else {
      encoded = this.storeNative(state.storage, 'read', state.generation);
    }
    const credential = decodeCredential(encoded);
    if (!credential || credential.installationId !== state.installationId || credential.generation !== state.generation) return null;
    return credential;
  }

  deleteRecord(state) {
    if (!state) return;
    if (state.storage === 'private-file') {
      try { fs.unlinkSync(this.fileFor(state.generation)); }
      catch (error) { if (error.code !== 'ENOENT') throw new Error('Could not remove the private Jicho credential file.'); }
    } else {
      this.storeNative(state.storage, 'delete', state.generation);
    }
  }

  writeState(state) {
    atomicPrivateWrite(this.stateFile, JSON.stringify(state, null, 2) + '\n');
    this.cacheKey = null;
    this.cacheValue = null;
  }

  getCredential() {
    const state = this.state();
    if (!state || state.status !== 'active') return null;
    const key = state.generation + ':' + state.storage;
    if (this.cacheKey === key) return this.cacheValue;
    let credential;
    try { credential = this.readRecord(state); }
    catch (_) { credential = null; }
    this.cacheKey = key;
    this.cacheValue = credential;
    return credential;
  }

  status() {
    const state = this.state();
    if (!state) return { status: 'missing', storage: null, installationId: null };
    if (state.status === 'revoked') return { status: 'revoked', storage: state.storage, installationId: state.installationId };
    const credential = this.getCredential();
    return { status: credential ? 'active' : 'unavailable', storage: state.storage, installationId: state.installationId };
  }

  ensureCredential() {
    const existingState = this.state();
    if (existingState && existingState.status === 'active') {
      if (!this.getCredential()) throw new Error('The Jicho credential is missing or unavailable. Run `npm run jicho -- credential rotate` after restoring credential-store access.');
      return { created: false, storage: existingState.storage, installationId: existingState.installationId };
    }
    if (existingState && existingState.status === 'revoked') throw new Error('Jicho hook credentials are revoked. Run `npm run jicho -- credential rotate` to provision a new credential.');

    const installationId = crypto.randomUUID();
    const generation = crypto.randomUUID();
    const record = { version: 1, installationId, generation, key: crypto.randomBytes(32).toString('base64url'), createdAt: Date.now() };
    let storage = this.nativeStorage();
    if (storage) {
      try { this.writeRecord(storage, record); }
      catch (_) {
        if (this.platform === 'win32') throw new Error('Windows Credential Manager is unavailable; Jicho did not write a plaintext fallback credential.');
        storage = 'private-file';
        this.writeRecord(storage, record);
      }
    } else {
      if (this.platform === 'win32') throw new Error('Windows Credential Manager is unavailable; Jicho did not write a plaintext fallback credential.');
      storage = 'private-file';
      this.writeRecord(storage, record);
    }
    const state = { version: 1, installationId, generation, storage, status: 'active', updatedAt: Date.now() };
    try { this.writeState(state); }
    catch (error) { try { this.deleteRecord({ ...state }); } catch (_) {} throw error; }
    return { created: true, storage, installationId };
  }

  rotate() {
    let oldState = null;
    try { oldState = this.state(); }
    catch (_) { /* Explicit rotation also repairs unreadable or unsafe state metadata. */ }
    const installationId = oldState ? oldState.installationId : crypto.randomUUID();
    const generation = crypto.randomUUID();
    const record = { version: 1, installationId, generation, key: crypto.randomBytes(32).toString('base64url'), createdAt: Date.now() };
    let storage = this.nativeStorage();
    if (oldState && oldState.status === 'active' && oldState.storage === 'private-file' && !storage) storage = 'private-file';
    if (storage) {
      try { this.writeRecord(storage, record); }
      catch (_) {
        if (this.platform === 'win32') throw new Error('Windows Credential Manager is unavailable; Jicho did not write a plaintext fallback credential.');
        storage = 'private-file';
        this.writeRecord(storage, record);
      }
    } else {
      if (this.platform === 'win32') throw new Error('Windows Credential Manager is unavailable; Jicho did not write a plaintext fallback credential.');
      storage = 'private-file';
      this.writeRecord(storage, record);
    }
    const state = { version: 1, installationId, generation, storage, status: 'active', updatedAt: Date.now() };
    try { this.writeState(state); }
    catch (error) { try { this.deleteRecord(state); } catch (_) {} throw error; }
    if (oldState) { try { this.deleteRecord(oldState); } catch (_) {} }
    return { storage, installationId };
  }

  revoke() {
    const state = this.state();
    if (!state || state.status === 'revoked') return false;
    const revoked = { ...state, status: 'revoked', updatedAt: Date.now() };
    this.writeState(revoked);
    try { this.deleteRecord(state); } catch (_) {}
    return true;
  }
}

module.exports = { CredentialManager, defaultDirectory, decodeCredential, encodeCredential, isUuid };
