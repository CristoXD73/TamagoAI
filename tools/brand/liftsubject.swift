// liftsubject.swift: cuts the subject out of an image with Apple's Vision (the "lift subject" model, on-device).
//   swiftc -O liftsubject.swift -o liftsubject && ./liftsubject in.png out.png
// Writes an RGBA PNG: the original pixels, alpha = the subject mask. Used for the startup-sequence assets.
import AppKit
import CoreImage
import Vision

let args = CommandLine.arguments
guard args.count == 3, let img = NSImage(contentsOfFile: args[1]),
      let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    FileHandle.standardError.write("usage: liftsubject in out\n".data(using: .utf8)!); exit(1)
}
let request = VNGenerateForegroundInstanceMaskRequest()
let handler = VNImageRequestHandler(cgImage: cg)
do {
    try handler.perform([request])
    guard let result = request.results?.first else { print("no subject"); exit(2) }
    let mask = try result.generateScaledMaskForImage(forInstances: result.allInstances, from: handler)
    let ci = CIImage(cgImage: cg)
    let m = CIImage(cvPixelBuffer: mask)
    let out = ci.applyingFilter("CIBlendWithMask", parameters: [kCIInputBackgroundImageKey: CIImage.empty(), kCIInputMaskImageKey: m])
    let ctx = CIContext()
    try ctx.writePNGRepresentation(of: out, to: URL(fileURLWithPath: args[2]), format: .RGBA8, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)
    print("ok \(result.allInstances.count) instance(s)")
} catch {
    print("failed: \(error)"); exit(3)
}
