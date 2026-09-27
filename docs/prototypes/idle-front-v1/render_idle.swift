// Preview-only analytic 2D animation of the imagegen front-facing RGBA asset.
// All temporal frequencies are integer harmonics of a 10-second cycle.
import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

let output = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let width = 768, height = 1024, fps = 30, count = 300
let inputURL = output.appendingPathComponent("octopus-front-source.png")
let input = CGImageSourceCreateWithURL(inputURL as CFURL, nil)!
let original = CGImageSourceCreateImageAtIndex(input, 0, nil)!
let sw = original.width, sh = original.height
let colorSpace = CGColorSpaceCreateDeviceRGB()
let bitmapInfo = CGBitmapInfo.byteOrder32Big.rawValue | CGImageAlphaInfo.premultipliedLast.rawValue
var source = [UInt8](repeating: 0, count: sw * sh * 4)
source.withUnsafeMutableBytes { bytes in
    let context = CGContext(data: bytes.baseAddress, width: sw, height: sh, bitsPerComponent: 8,
                            bytesPerRow: sw * 4, space: colorSpace, bitmapInfo: bitmapInfo)!
    context.draw(original, in: CGRect(x: 0, y: 0, width: sw, height: sh))
}
@inline(__always) func smooth(_ a: Double, _ b: Double, _ x: Double) -> Double {
    let t = min(1, max(0, (x-a)/(b-a)))
    return t*t*(3-2*t)
}
struct Field { var dx1: Double; var dx2: Double; var dy1: Double; var dy2: Double }
let drawW = 614.4, drawH = 921.6
let left = (Double(width)-drawW)/2, top = (Double(height)-drawH)/2
func render(_ index: Int) -> [UInt8] {
    let phase = 2 * Double.pi * Double(index) / Double(count)
    let driftX = 5.0*sin(phase), driftY = 14.0*sin(phase) + 2.0*sin(2*phase)
    let angle = 0.009*sin(phase+0.4)
    let ca = cos(angle), sa = sin(angle)
    let pulse = 0.006*sin(2*phase)
    var dest = [UInt8](repeating: 0, count: width*height*4)
    for y in 0..<height {
        for x in 0..<width {
            let rx = Double(x)-Double(width)/2-driftX
            let ry = Double(y)-Double(height)*0.44-driftY
            let px = ca*rx+sa*ry+Double(width)/2
            let py = -sa*rx+ca*ry+Double(height)*0.44
            let nx = (px-left)/drawW, ny = (py-top)/drawH
            if nx < -0.06 || nx > 1.06 || ny < -0.04 || ny > 1.04 { continue }
            let arms = pow(smooth(0.37,0.94,ny),1.4)
            let mantle = 1-smooth(0.25,0.47,ny)
            // Two slow travelling waves; neighboring arm columns have staggered phases.
            let waveX = arms*(0.018*sin(phase-ny*5.2+nx*3.1)
                              + 0.008*sin(2*phase-ny*7.8-nx*5.3+0.8))
            let waveY = arms*(0.006*sin(phase-ny*4.1+nx*5.0)
                              + 0.004*sin(2*phase-ny*6.0-nx*4.0))
            let sx = (nx-waveX-(nx-0.5)*pulse*mantle)*Double(sw)
            let sy = (ny-waveY+(ny-0.38)*pulse*0.45*mantle)*Double(sh)
            let ix = Int(floor(sx)), iy = Int(floor(sy))
            if ix < 0 || iy < 0 || ix+1 >= sw || iy+1 >= sh { continue }
            let fx = sx-Double(ix), fy = sy-Double(iy)
            let p00 = (iy*sw+ix)*4, p01=p00+4, p10=p00+sw*4, p11=p10+4
            let d = (y*width+x)*4
            for channel in 0..<4 {
                let v0 = Double(source[p00+channel])*(1-fx)+Double(source[p01+channel])*fx
                let v1 = Double(source[p10+channel])*(1-fx)+Double(source[p11+channel])*fx
                dest[d+channel] = UInt8(min(255,max(0,(v0*(1-fy)+v1*fy).rounded())))
            }
        }
    }
    return dest
}
func save(_ pixels: [UInt8], _ name: String) {
    let data = Data(pixels)
    let provider = CGDataProvider(data: data as CFData)!
    let image = CGImage(width: width,height: height,bitsPerComponent: 8,bitsPerPixel: 32,
                        bytesPerRow: width*4,space: colorSpace,bitmapInfo: CGBitmapInfo(rawValue: bitmapInfo),
                        provider: provider,decode: nil,shouldInterpolate: true,intent: .defaultIntent)!
    let url=output.appendingPathComponent(name)
    let writer=CGImageDestinationCreateWithURL(url as CFURL,UTType.png.identifier as CFString,1,nil)!
    CGImageDestinationAddImage(writer,image,nil)
    precondition(CGImageDestinationFinalize(writer))
}
let first = render(0), closure = render(count)
precondition(first == closure, "10-second endpoint must exactly equal the first frame")
save(first,"poster.png")
for index in 0..<count {
    autoreleasepool {
        let frame = index == 0 ? first : render(index)
        save(frame,String(format:"frames/frame-%04d.png",index))
    }
    if index % 60 == 0 { print("Rendered \(index)/\(count)"); fflush(stdout) }
}
print("Rendered 300 RGBA frames at 30 fps. Frame at 10.0s exactly equals frame at 0.0s.")
