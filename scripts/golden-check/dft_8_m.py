"""Python transcription of ~/workspace_v12/dft_8_m/main.c with C6000 float semantics (numpy float32)."""
import math
import numpy as np

f32 = np.float32
x = [f32(v) for v in (1, 1, 2, 3, 0, 2, 1, 3)]
N = 8
XR = [f32(0)] * 8
XI = [f32(0)] * 8
for j in range(N):
    XR[j] = f32(0)
    XI[j] = f32(0)
    for i in range(N):
        XR[j] = f32(float(XR[j]) + float(x[i]) * math.cos(2.0 * 3.14 * i * j / N))
        XI[j] = f32(float(XI[j]) - float(x[i]) * math.sin(2.0 * 3.14 * i * j / N))
    print("%f +i %f" % (XR[j], XI[j]))
for i in range(N):
    amplitude = f32(math.sqrt(float(XR[i] * XR[i] + XI[i] * XI[i])))
    print("amplitude %f " % amplitude)
for i in range(N):
    print("phase %f " % f32(math.atan2(float(XI[i]), float(XR[i]))))
