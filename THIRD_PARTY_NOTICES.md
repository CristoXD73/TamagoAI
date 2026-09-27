# Third-Party Notices

Apple Tamago includes source code adapted from the MIT-licensed projects below.
The license text is reproduced exactly as the MIT License requires. **No artwork,
sprites, icons, or other assets from these projects are included.**

See `docs/UPSTREAM_REUSE.md` for exactly what was reused and why.

---

## WatchPet

- Repository: https://github.com/lkuczborski/WatchPet
- Commit: `d52a77a1d15374b1443a46e26ddba11920d3b894`
- Used in: `Apple/Shared/SpriteAnimationClock.swift` (adapted)

```
MIT License

Copyright (c) 2026 Łukasz Kuczborski

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Q007

- Repository: https://github.com/chris-jk/Q007
- Commit: `d422082ed1f419eef01ea15fd8d8266367410b24`
- Used in: **nothing yet.** Reviewed only; no source copied. If a later agent
  adapts any Q007 file (e.g. `KeychainService.swift`), it must add the file to
  this section and keep the license below.

```
MIT License

Copyright (c) 2026 cannappy.org

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Local voice engine (not included in this repository)

The optional natural voice (D-121) uses **sherpa-onnx** (Apache-2.0), **Kokoro-82M** (Apache-2.0 weights) and
**KittenTTS** (Apache-2.0). They're downloaded by `Gateway/tools/tts/setup.sh` onto the owner's Mac and are
**not redistributed** here. Their model packages contain espeak-ng data (GPL-3.0), which our code doesn't link
or ship. Details: `docs/UPSTREAM_REUSE.md` and `docs/VOICE_RESEARCH.md`. Anyone who later bundles these
components must reproduce their licenses here.
