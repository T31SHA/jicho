import SwiftUI

// MARK: - Timing constants

private enum GT {
    static let badge:    Double = 1.18
    static let blink2:   Double = 3.42
    static let tint0:    Double = 1.50
    static let tint1:    Double = 2.18
    static let end:      Double = 4.05
    static let autoLeave:Double = 4.35
    static let COLLAPSE: Double = 0.34
}

// MARK: - Geometry constants (640×150 reference space)

private let GC0     = CGPoint(x: 320, y: 90)
private let GHB:    CGFloat = 58
private let GASP:   CGFloat = 1.06
private let GEAR_X: CGFloat = 40
private let GEAR_HB:CGFloat = 17
private let GCARD   = CGRect(x: 10, y: 36, width: 620, height: 104)
private let GCARD_R:CGFloat = 20

// MARK: - Easing

private enum GE {
    static func out(_ t: Double)    -> Double { 1 - pow(1 - t, 3) }
    static func easeIn(_ t: Double) -> Double { t * t * t }
    static func inOut(_ t: Double)  -> Double {
        t < 0.5 ? 4*t*t*t : 1 - pow(-2*t+2, 3)/2
    }
    static func back(_ t: Double)   -> Double {
        let c1=1.70158, c3=c1+1
        return 1 + c3*pow(t-1,3) + c1*pow(t-1,2)
    }
}

private func gClamp(_ v: Double, _ a: Double, _ b: Double) -> Double { max(a, min(b, v)) }
private func gLerp(_ a: Double, _ b: Double, _ t: Double)  -> Double { a + (b - a) * t }
private func gSeg(_ t: Double, _ a: Double, _ b: Double)   -> Double { gClamp((t-a)/(b-a), 0, 1) }
private func gLerpF(_ a: CGFloat, _ b: CGFloat, _ t: CGFloat) -> CGFloat { a + (b-a)*t }

// MARK: - Pose

private enum GEyeType { case dot, happy, content, pill, wide, wink, closed }

private struct GreetPose {
    var hb, x, y, sx, sy, tilt: Double
    var eye: GEyeType; var open, eyeRoll: Double
    var lookX, lookY: Double
    var badge, tint, halo, haloBlue, minis, fx: Double
    var header, card: Double
    var iw, ih: Double
}

// MARK: - Particle data (seeded LCG, seed=7)

private struct GWarpStreak { let xNorm, speed, len, thick, alpha, t0: Double }
private struct GRingDot    { let a, j, s, al: Double }

private let greetParticles: (warps: [GWarpStreak], ring: [GRingDot]) = {
    var seed: UInt32 = 7
    func rnd() -> Double {
        seed = (seed &* 1103515245 &+ 12345) & 0x7fffffff
        return Double(seed) / Double(0x7fff_ffff)
    }
    // ~70 white warp streaks for the fall-in (0 → 0.55 s)
    let warps = (0..<70).map { _ in
        GWarpStreak(xNorm: rnd(),
                    speed: 400 + rnd() * 300,
                    len:   6   + rnd() * 16,
                    thick: 1   + rnd() * 0.5,
                    alpha: 0.25 + rnd() * 0.55,
                    t0:   rnd() * 0.35)
    }
    // Single burst ring at 0.45 s, ~90 dots, white
    let ring = (0..<90).map { _ in
        GRingDot(a: rnd() * .pi * 2, j: (rnd()-0.5)*0.22,
                 s: 0.7+rnd()*0.9,   al: 0.45+rnd()*0.55)
    }
    return (warps, ring)
}()

// MARK: - Pose computation

private func greetPose(_ t: Double, compact: IslandRestingLayout) -> GreetPose {
    let gx = gSeg(t, 0, 0.5)
    let g = sin(.pi * gx / 2) + 0.04 * sin(.pi * gx) * gx
    let iw = gLerp(Double(compact.width - 160), 640, g)
    let ih = gLerp(Double(compact.height), 150, g)

    let GH = Double(GHB)
    let cx = Double(GC0.x)
    let cy = Double(GC0.y)
    let hb: Double = t < 0.20 ? 0 : gLerp(GH * 0.15, GH, GE.back(gSeg(t, 0.20, 0.60)))
    let landY = cy + 0.12 * GH
    let peakY = cy - 0.12 * GH
    let dipY = cy + 0.18 * GH

    var y: Double
    if t < 0.20 { y = Double(compact.botCenterY) }
    else if t < 0.60 { y = gLerp(Double(compact.botCenterY), landY, GE.easeIn(gSeg(t, 0.20, 0.60))) }
    else if t < 0.82 { y = gLerp(landY, peakY, GE.out(gSeg(t, 0.60, 0.82))) }
    else if t < 1.08 { y = gLerp(peakY, cy, GE.back(gSeg(t, 0.82, 1.08))) }
    else if t < 2.28 { y = cy + sin((t - 1.08) * .pi * 1.7) * GH * 0.012 }
    else if t < 2.46 { y = gLerp(cy, dipY, GE.easeIn(gSeg(t, 2.28, 2.46))) }
    else if t < 2.74 { y = gLerp(dipY, cy, GE.out(gSeg(t, 2.46, 2.74))) }
    else if t < 3.55 { y = cy }
    else { y = gLerp(cy, Double(compact.botCenterY), GE.inOut(gSeg(t, 3.55, 4.05))) }

    let landSqK = (t >= 0.52 && t < 0.70) ? sin(.pi * gSeg(t, 0.52, 0.70)) : 0
    let saluteK = (t >= 1.12 && t < 1.52) ? sin(.pi * gSeg(t, 1.12, 1.52)) : 0
    let nodK = (t >= 2.25 && t < 2.72) ? sin(.pi * gSeg(t, 2.25, 2.72)) : 0
    let sx = 1 + 0.16 * landSqK - 0.045 * saluteK + 0.06 * nodK
    let sy = 1 - 0.16 * landSqK + 0.08 * saluteK - 0.055 * nodK

    var eye: GEyeType = .closed
    if t >= 0.72 && t < 1.04 { eye = .wide }
    else if t >= 1.04 && t < 1.36 { eye = .pill }
    else if t >= 1.36 && t < 1.72 { eye = .wink }
    else if t >= 1.72 && t < 2.50 { eye = .happy }
    else if t >= 2.50 { eye = .pill }
    let blink: (Double) -> Double = { tb in
        let k = gSeg(t, tb, tb + 0.12)
        return (k > 0 && k < 1) ? 1 - sin(.pi * k) * 0.94 : 1
    }
    let openVal = min(blink(2.92), blink(GT.blink2))

    var lookX = 0.0, lookY = 0.0
    if t >= 0.72 && t < 1.36 { lookX = -0.25; lookY = -0.12 }
    else if t >= 1.36 && t < 1.72 { lookX = 0.3; lookY = -0.1 }
    else if t >= 1.72 && t < 2.50 { lookY = 0.05 }
    else if t >= 2.50 {
        let k = GE.inOut(gSeg(t, 2.50, 2.95))
        lookX = gLerp(0, 0.08, k); lookY = gLerp(0.05, 0, k)
    }

    return GreetPose(
        hb: hb, x: cx, y: y, sx: sx, sy: sy,
        tilt: (t >= 2.28 && t < 2.74) ? 0.045 * nodK : 0,
        eye: eye, open: openVal, eyeRoll: 0,
        lookX: lookX, lookY: lookY,
        badge: GE.back(gSeg(t, GT.badge, GT.badge + 0.28)),
        tint: 0.6 * GE.inOut(gSeg(t, GT.tint0, GT.tint1)),
        halo: GE.out(gSeg(t, 0.3, 0.7)),
        haloBlue: gSeg(t, GT.tint0, GT.tint1),
        minis: 0, fx: 1,
        header: gSeg(t, 0.35, 0.6), card: gSeg(t, 0.18, 0.45),
        iw: iw, ih: ih
    )
}

private func smallPose(_ compact: IslandRestingLayout) -> GreetPose {
    let sw = Double(compact.width)
    return GreetPose(
        hb: Double(GEAR_HB * compact.botDiameter / 20),
        x: 320 - sw/2 + Double(GEAR_X),
        y: Double(compact.botCenterY),
        sx: 1, sy: 1, tilt: 0,
        eye: .dot, open: 1, eyeRoll: 0,
        lookX: 0, lookY: 0,
        badge: 1, tint: 0.6, halo: 0.6, haloBlue: 1,
        minis: 1, fx: 1,
        header: 0, card: 0,
        iw: sw, ih: Double(compact.height)
    )
}

private func pose(_ t: Double, tc: Double, compact: IslandRestingLayout) -> GreetPose {
    if t < tc { return greetPose(min(t, GT.end + 10), compact: compact) }
    let a = greetPose(tc, compact: compact)
    let b = smallPose(compact)
    let e = GE.inOut(gSeg(t, tc, tc + GT.COLLAPSE))
    var p = a
    p.iw = gLerp(a.iw, b.iw, e); p.ih = gLerp(a.ih, b.ih, e)
    p.x  = gLerp(a.x, b.x, e);   p.y  = gLerp(a.y, b.y, e)
    p.hb = gLerp(a.hb, b.hb, e)
    p.badge    = gLerp(a.badge, b.badge, e)
    p.tint     = gLerp(a.tint,  b.tint,  e)
    p.halo     = gLerp(a.halo,  b.halo,  e)
    p.haloBlue = gLerp(a.haloBlue, b.haloBlue, e)
    p.header   = a.header * (1 - gSeg(t, tc, tc+0.1))
    p.card     = a.card   * (1 - gSeg(t, tc, tc+0.18))
    p.tilt     = a.tilt * (1 - e)
    p.sx       = gLerp(a.sx, 1, e); p.sy = gLerp(a.sy, 1, e)
    p.eyeRoll  = a.eyeRoll * (1 - e)
    let bk = gSeg(t, tc+0.14, tc+0.26)
    p.eye = .dot; p.open = (bk > 0 && bk < 1) ? 1 - sin(.pi*bk)*0.94 : 1
    p.lookX = a.lookX*(1-e); p.lookY = a.lookY*(1-e)
    p.minis = GE.back(gSeg(t, tc+0.24, tc+0.42))
    p.fx    = 1 - gSeg(t, tc, tc+0.2)
    return p
}

// MARK: - Drawing helpers

private func gHex(_ hex: String, alpha: CGFloat = 1) -> CGColor {
    let h = hex.trimmingCharacters(in: CharacterSet(charactersIn:"#"))
    let v = UInt64(h, radix: 16) ?? 0
    return CGColor(red: CGFloat((v>>16)&0xFF)/255,
                   green: CGFloat((v>>8)&0xFF)/255,
                   blue: CGFloat(v&0xFF)/255, alpha: alpha)
}

private func gRR(_ ctx: CGContext, _ x: CGFloat, _ y: CGFloat,
                 _ w: CGFloat, _ h: CGFloat, _ r: CGFloat) {
    let r = max(0, min(r, w/2, h/2))
    ctx.beginPath()
    ctx.move(to: CGPoint(x: x+r, y: y))
    ctx.addArc(tangent1End: CGPoint(x: x+w, y: y),   tangent2End: CGPoint(x: x+w, y: y+h), radius: r)
    ctx.addArc(tangent1End: CGPoint(x: x+w, y: y+h), tangent2End: CGPoint(x: x,   y: y+h), radius: r)
    ctx.addArc(tangent1End: CGPoint(x: x,   y: y+h), tangent2End: CGPoint(x: x,   y: y),   radius: r)
    ctx.addArc(tangent1End: CGPoint(x: x,   y: y),   tangent2End: CGPoint(x: x+r, y: y),   radius: r)
    ctx.closePath()
}

private func kitoPath(hw: CGFloat, hh: CGFloat) -> CGPath {
    let n: CGFloat = 3.2
    let path = CGMutablePath()
    let steps = 96
    for i in 0...steps {
        let a = CGFloat(i)/CGFloat(steps)*2 * .pi
        let ca = cos(a), sa = sin(a)
        let px = hw * (ca < 0 ? -1 : 1) * pow(abs(ca), 2/n)
        let py = hh * (sa < 0 ? -1 : 1) * pow(abs(sa), 2/n)
        if i == 0 { path.move(to: CGPoint(x: px, y: py)) }
        else { path.addLine(to: CGPoint(x: px, y: py)) }
    }
    path.closeSubpath(); return path
}

private func whiteFill(_ ctx: CGContext, _ path: CGPath,
                       x0: CGFloat, y0: CGFloat, x1: CGFloat, y1: CGFloat) {
    let cs = CGColorSpaceCreateDeviceRGB()
    let c0 = CGColor(red: 167/255, green: 170/255, blue: 176/255, alpha: 1)
    let c1 = CGColor(red: 119/255, green: 122/255, blue: 129/255, alpha: 1)
    guard let g = CGGradient(colorsSpace: cs, colors: [c0,c1] as CFArray, locations: [0,1]) else { return }
    ctx.saveGState()
    ctx.addPath(path); ctx.clip()
    ctx.drawLinearGradient(g, start: CGPoint(x: x0, y: y0),
                              end:   CGPoint(x: x1, y: y1),
                              options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
    ctx.restoreGState()
}

private func drawKito(_ ctx: CGContext, p: GreetPose) {
    let hh = CGFloat(p.hb/2), hw = hh*GASP; guard hh > 0.4 else { return }

    // Halo (golden → blue)
    if p.halo > 0 {
        let bl = CGFloat(p.haloBlue)
        let cr = gLerpF(232/255, 59/255, bl)
        let cg = gLerpF(195/255, 158/255, bl)
        let cb = gLerpF(154/255, 255/255, bl)
        let cs = CGColorSpaceCreateDeviceRGB()
        let px = CGFloat(p.x), py = CGFloat(p.y)
        let R1 = hw * 2.6
        let ic1 = CGColor(red: cr, green: cg, blue: cb, alpha: CGFloat(0.18 * p.halo))
        let oc1 = CGColor(red: cr, green: cg, blue: cb, alpha: 0)
        if let g1 = CGGradient(colorsSpace: cs, colors: [ic1,oc1] as CFArray, locations: [0,1]) {
            ctx.saveGState()
            ctx.addEllipse(in: CGRect(x: px-R1, y: py-R1, width: R1*2, height: R1*2))
            ctx.clip()
            ctx.drawRadialGradient(g1, startCenter: CGPoint(x: px,y: py), startRadius: 0,
                                   endCenter: CGPoint(x: px,y: py), endRadius: R1, options: [])
            ctx.restoreGState()
        }
        let R2 = hw * 4.2
        let ic2 = CGColor(red: cr, green: cg, blue: cb, alpha: CGFloat(0.07 * p.halo))
        let oc2 = CGColor(red: cr, green: cg, blue: cb, alpha: 0)
        if let g2 = CGGradient(colorsSpace: cs, colors: [ic2,oc2] as CFArray, locations: [0,1]) {
            ctx.saveGState()
            ctx.addEllipse(in: CGRect(x: px-R2, y: py-R2, width: R2*2, height: R2*2))
            ctx.clip()
            ctx.drawRadialGradient(g2, startCenter: CGPoint(x: px,y: py), startRadius: 0,
                                   endCenter: CGPoint(x: px,y: py), endRadius: R2, options: [])
            ctx.restoreGState()
        }
    }

    ctx.saveGState()
    ctx.translateBy(x: CGFloat(p.x), y: CGFloat(p.y))
    ctx.rotate(by: CGFloat(p.tilt))
    ctx.scaleBy(x: CGFloat(p.sx), y: CGFloat(p.sy))

    let mpath = kitoPath(hw: hw, hh: hh)
    whiteFill(ctx, mpath, x0: hw*0.6, y0: -hh, x1: -hw*0.6, y1: hh)
    ctx.addPath(mpath); ctx.setStrokeColor(gHex("#343B45")); ctx.setLineWidth(max(1.5, hh * 0.045)); ctx.strokePath()

    ctx.saveGState()
    ctx.addPath(mpath); ctx.clip()
    let shoulder = CGMutablePath()
    shoulder.move(to: CGPoint(x: -hw * 0.78, y: hh * 0.98))
    shoulder.addCurve(to: CGPoint(x: -hw * 0.28, y: hh * 0.43), control1: CGPoint(x: -hw * 0.74, y: hh * 0.62), control2: CGPoint(x: -hw * 0.5, y: hh * 0.43))
    shoulder.addLine(to: CGPoint(x: hw * 0.28, y: hh * 0.43))
    shoulder.addCurve(to: CGPoint(x: hw * 0.78, y: hh * 0.98), control1: CGPoint(x: hw * 0.5, y: hh * 0.43), control2: CGPoint(x: hw * 0.74, y: hh * 0.62))
    shoulder.closeSubpath()
    ctx.addPath(shoulder); ctx.setFillColor(gHex("#646970")); ctx.fillPath()
    ctx.setStrokeColor(gHex("#E8B9A0")); ctx.setLineWidth(max(1, hh * 0.035)); ctx.setLineCap(.round)
    for side: CGFloat in [-1, 1] { ctx.beginPath(); ctx.move(to: CGPoint(x: side * hh * 0.31, y: hh * 0.45)); ctx.addLine(to: CGPoint(x: side * hh * 0.29, y: hh * 0.61)); ctx.strokePath() }
    ctx.restoreGState()

    let rim = CGPath(ellipseIn: CGRect(x: -hw * 0.78, y: -hh * 0.84, width: hw * 1.56, height: hh * 1.44), transform: nil)
    // Draw the raised hood as a filled ellipse and a fine alloy edge.
    ctx.addEllipse(in: CGRect(x: -hw * 0.78, y: -hh * 0.84, width: hw * 1.56, height: hh * 1.44)); ctx.setFillColor(gHex("#646970")); ctx.fillPath()
    ctx.addPath(rim); ctx.setStrokeColor(gHex("#A7AAB0")); ctx.setLineWidth(max(1, hh * 0.035)); ctx.strokePath()
    let visorRect = CGRect(x: -hw * 0.59, y: -hh * 0.35, width: hw * 1.18, height: hh * 0.55)
    let visor = CGPath(roundedRect: visorRect, cornerWidth: hh * 0.23, cornerHeight: hh * 0.23, transform: nil)
    ctx.addPath(visor); ctx.setFillColor(gHex("#111216")); ctx.fillPath()
    ctx.addPath(visor); ctx.setStrokeColor(gHex("#C2CDD3", alpha: 0.62)); ctx.setLineWidth(max(0.8, hh * 0.027)); ctx.strokePath()
    ctx.addEllipse(in: CGRect(x: -hw * 0.45, y: -hh * 0.30, width: hw * 0.3, height: hh * 0.07)); ctx.setFillColor(gHex("#FFFFFF", alpha: 0.09)); ctx.fillPath()

    ctx.saveGState()
    ctx.addPath(visor); ctx.clip()
    let lens = gHex("#FF8A80")
    let core = gHex("#FFE3DF")
    let er = CGFloat(p.hb * 0.075)
    let sp = CGFloat(p.hb * 0.17)
    let lx = CGFloat(p.lookX) * hw * 0.42
    let ly = CGFloat(p.lookY) * hh * 0.28 + hh * 0.12 + CGFloat(p.eyeRoll) * hh * 1.25
    for sd: CGFloat in [-1, 1] {
        ctx.saveGState(); ctx.translateBy(x: sd * sp + lx, y: ly)
        if p.eye == .happy || p.eye == .content {
            ctx.setStrokeColor(lens); ctx.setLineWidth(er * 0.62); ctx.setLineCap(.round)
            ctx.beginPath(); ctx.addArc(center: CGPoint(x: 0, y: er * 0.15), radius: er * 0.76, startAngle: .pi * 1.13, endAngle: .pi * 1.87, clockwise: false); ctx.strokePath()
            ctx.setStrokeColor(core); ctx.setLineWidth(er * 0.2)
            ctx.beginPath(); ctx.addArc(center: CGPoint(x: 0, y: er * 0.15), radius: er * 0.76, startAngle: .pi * 1.3, endAngle: .pi * 1.7, clockwise: false); ctx.strokePath()
        } else if p.eye == .closed {
            ctx.setStrokeColor(lens); ctx.setLineWidth(er * 0.45); ctx.setLineCap(.round)
            ctx.beginPath(); ctx.move(to: CGPoint(x: -er * 0.7, y: 0)); ctx.addQuadCurve(to: CGPoint(x: er * 0.7, y: 0), control: CGPoint(x: 0, y: er * 0.18)); ctx.strokePath()
        } else if p.eye == .wink && sd > 0 {
            ctx.setStrokeColor(lens); ctx.setLineWidth(er * 0.45); ctx.setLineCap(.round)
            ctx.beginPath(); ctx.move(to: CGPoint(x: -er * 0.7, y: er * 0.12)); ctx.addQuadCurve(to: CGPoint(x: er * 0.7, y: er * 0.12), control: CGPoint(x: 0, y: -er * 0.45)); ctx.strokePath()
        } else {
            let ew = p.eye == .wide ? er * 1.2 : er
            let eh = p.eye == .wide ? er * 1.42 : er * 1.2
            let eyeH = eh * max(0.22, CGFloat(p.open))
            let capsule = CGPath(roundedRect: CGRect(x: -ew * 0.5, y: -eyeH * 0.5, width: ew, height: eyeH), cornerWidth: ew * 0.5, cornerHeight: ew * 0.5, transform: nil)
            ctx.addPath(capsule); ctx.setStrokeColor(lens.copy(alpha: 0.3) ?? lens); ctx.setLineWidth(er * 0.55); ctx.strokePath()
            ctx.addPath(capsule); ctx.setFillColor(lens); ctx.fillPath()
            let highlight = CGPath(roundedRect: CGRect(x: -ew * 0.18, y: -eyeH * 0.26, width: ew * 0.36, height: eyeH * 0.52), cornerWidth: ew * 0.18, cornerHeight: ew * 0.18, transform: nil)
            ctx.addPath(highlight); ctx.setFillColor(core); ctx.fillPath()
        }
        ctx.restoreGState()
    }
    ctx.restoreGState()

    // Activity badge
    if p.badge > 0.01 {
        let bs = CGFloat(p.badge)
        let br = hh*0.3
        ctx.saveGState()
        ctx.translateBy(x: -hw*0.78, y: -hh*0.72)
        ctx.scaleBy(x: bs, y: bs)
        ctx.setFillColor(gHex("#000000"))
        ctx.addEllipse(in: CGRect(x: -(br+hh*0.07), y: -(br+hh*0.07),
                                  width: (br+hh*0.07)*2, height: (br+hh*0.07)*2))
        ctx.fillPath()
        ctx.setFillColor(gHex("#3BA0F5"))
        ctx.addEllipse(in: CGRect(x: -br, y: -br, width: br*2, height: br*2))
        ctx.fillPath()
        ctx.setFillColor(gHex("#0B1B3A"))
        for i: CGFloat in [-1, 0, 1] {
            ctx.addEllipse(in: CGRect(x: i*br*0.5-br*0.17, y: -br*0.17,
                                      width: br*0.34, height: br*0.34))
            ctx.fillPath()
        }
        ctx.restoreGState()
    }

    ctx.restoreGState()
}

private func drawParticles(_ ctx: CGContext, t: Double, tc: Double, p: GreetPose) {
    guard p.card > 0 || p.fx < 1 else { return }
    let fx = p.fx

    // WARP STREAKS: white vertical lines, fall-in 0 → 0.55 s
    if t < 0.55 {
        for s in greetParticles.warps {
            guard t >= s.t0 else { continue }
            let elapsed = t - s.t0
            let yBot = CGFloat(elapsed * s.speed)
            let yTop = yBot - CGFloat(s.len)
            guard yBot > 0 else { continue }
            let streakX  = CGFloat(320 - p.iw/2 + s.xNorm * p.iw)
            let fadeOut  = 1 - gSeg(t, 0.40, 0.55)
            let alpha    = CGFloat(s.alpha * fx * fadeOut)
            ctx.setStrokeColor(CGColor(red: 1, green: 1, blue: 1, alpha: alpha))
            ctx.setLineWidth(CGFloat(s.thick)); ctx.setLineCap(.butt)
            ctx.beginPath()
            ctx.move(to:    CGPoint(x: streakX, y: max(0, yTop)))
            ctx.addLine(to: CGPoint(x: streakX, y: min(150, yBot)))
            ctx.strokePath()
        }
    }

    // RING: single white burst at 0.45 s, ~90 dots
    let ringT0 = 0.45
    let k = gSeg(t, ringT0, ringT0 + 1.35)
    if k > 0 && k < 1 {
        let rx   = gLerpF(14, 380, CGFloat(GE.out(k)))
        let ry   = rx * 0.34
        let fade = CGFloat((1-k) * (k < 0.08 ? k/0.08 : 1) * fx * p.card)
        for dot in greetParticles.ring {
            let r: CGFloat = 1 + CGFloat(dot.j)
            ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1,
                                     alpha: CGFloat(dot.al) * fade))
            let dx = CGFloat(GC0.x) + cos(CGFloat(dot.a)) * rx * r
            let dy = CGFloat(GC0.y) + sin(CGFloat(dot.a)) * ry * r
            ctx.fill(CGRect(x: dx, y: dy, width: CGFloat(dot.s), height: CGFloat(dot.s)))
        }
    }
}

private func drawHeader(_ ctx: CGContext, alpha: Double) {
    guard alpha > 0 else { return }
    ctx.saveGState()
    ctx.setAlpha(CGFloat(alpha))
    gRR(ctx, 18, 4, 44, 26, 13)
    ctx.setFillColor(gHex("#1D1F23")); ctx.fillPath()
    ctx.setFillColor(gHex("#F5F6F8"))
    ctx.beginPath()
    ctx.move(to: CGPoint(x: 33, y: 20)); ctx.addLine(to: CGPoint(x: 40, y: 13))
    ctx.addLine(to: CGPoint(x: 47, y: 20)); ctx.addLine(to: CGPoint(x: 47, y: 25))
    ctx.addLine(to: CGPoint(x: 33, y: 25)); ctx.closePath(); ctx.fillPath()
    ctx.setFillColor(gHex("#8E939C"))
    ctx.addEllipse(in: CGRect(x: 75.5, y: 10.5, width: 13, height: 13)); ctx.fillPath()
    ctx.addEllipse(in: CGRect(x: 572, y: 11, width: 12, height: 12)); ctx.fillPath()
    ctx.setFillColor(gHex("#000000"))
    ctx.addEllipse(in: CGRect(x: 575.6, y: 14.6, width: 4.8, height: 4.8)); ctx.fillPath()
    ctx.restoreGState()
}

private let miniColors = ["#E86A6A","#3E86E0","#EFAE5A","#8C73F2"]

private func drawMinis(_ ctx: CGContext, alpha: Double, compact: IslandRestingLayout) {
    guard alpha > 0.01 else { return }
    let cx = 320 - compact.width/2 + compact.miniGridCenterX
    let cy = compact.botCenterY
    let sp: CGFloat = 6 * compact.miniGridScale
    let offsets: [(CGFloat, CGFloat)] = [(-sp,-sp),(sp,-sp),(-sp,sp),(sp,sp)]
    for (i,(dx,dy)) in offsets.enumerated() {
        ctx.saveGState()
        ctx.translateBy(x: cx+dx, y: cy+dy)
        let scale = CGFloat(alpha) * compact.miniGridScale
        ctx.scaleBy(x: scale, y: scale)
        ctx.setFillColor(gHex(miniColors[i]))
        ctx.addPath(kitoPath(hw: 5.3, hh: 4)); ctx.fillPath()
        ctx.restoreGState()
    }
}

// MARK: - Full draw

private func drawGreeting(_ ctx: CGContext, size: CGSize, t: Double,
                          tc: Double, compact: IslandRestingLayout) {
    let p = pose(t, tc: tc, compact: compact)

    if p.card > 0 {
        ctx.saveGState()
        ctx.setAlpha(CGFloat(p.card))
        gRR(ctx, GCARD.minX, GCARD.minY, GCARD.width, GCARD.height, GCARD_R)
        ctx.setFillColor(gHex("#141518")); ctx.fillPath()
        ctx.restoreGState()

        ctx.saveGState()
        gRR(ctx, GCARD.minX, GCARD.minY, GCARD.width, GCARD.height, GCARD_R)
        ctx.clip()
        drawParticles(ctx, t: t, tc: tc, p: p)
        ctx.restoreGState()
    } else if tc.isFinite && t >= tc {
        ctx.saveGState()
        drawParticles(ctx, t: t, tc: tc, p: p)
        ctx.restoreGState()
    }

    drawMinis(ctx, alpha: p.minis, compact: compact)
    drawKito(ctx, p: p)
}

// MARK: - SwiftUI View

struct GreetingCanvasView: View {
    @ObservedObject var state: AppState

    @State private var startDate = Date()
    @State private var tc: Double = .infinity
    @State private var greetFired = false
    @State private var doneWork: DispatchWorkItem? = nil

    var body: some View {
        TimelineView(.animation) { timeline in
            let t = timeline.date.timeIntervalSince(startDate)
            Canvas { context, size in
                context.withCGContext { cgCtx in
                    drawGreeting(cgCtx, size: size, t: t, tc: tc,
                                 compact: IslandRestingLayout(width: state.notchWidth + 160,
                                                              height: state.notchHeight))
                }
            }
            .onChange(of: !greetFired && t >= GT.end && tc >= GT.autoLeave) { _, trigger in
                if trigger { fireGreetComplete() }
            }
        }
        .onAppear {
            startDate = Date()
            tc = .infinity
            greetFired = false
            // Original score plays from the start; greet.wav and blip.wav kept for other uses
            SoundEngine.shared.play("greeting")
            // Safety fallback: fire done if timeline onChange misses it
            let item = DispatchWorkItem { fireGreetComplete() }
            doneWork = item
            DispatchQueue.main.asyncAfter(deadline: .now() + GT.end + 0.05, execute: item)
        }
        .onDisappear {
            doneWork?.cancel(); doneWork = nil
            SoundEngine.shared.fadeOut("greeting", duration: 0.2)
        }
        .onReceive(NotificationCenter.default.publisher(for: .greetingHover)) { _ in
            if tc >= GT.autoLeave { tc = .infinity }
        }
        .onReceive(NotificationCenter.default.publisher(for: .greetingInterrupt)) { _ in
            let t = Date().timeIntervalSince(startDate)
            if tc.isInfinite || tc > t { tc = t }
            doneWork?.cancel(); doneWork = nil
            SoundEngine.shared.fadeOut("greeting", duration: 0.25)
        }
    }

    private func fireGreetComplete() {
        guard !greetFired else { return }
        greetFired = true
        doneWork?.cancel(); doneWork = nil
        // Note: greeting music continues for ~0.3 s after greetComplete — intentional queue overlap
        NotificationCenter.default.post(name: .greetComplete, object: nil)
    }
}
