"""Python transcription of ~/workspace_v12/linear_disc_conv/main.c (float convolution)."""
import math
import numpy as np

f32 = np.float32
NT = 400
DT = f32(0.01)
NY = 2 * NT - 1
t = [f32(0)] * NT
x = [f32(0)] * NT
h = [f32(0)] * NT
y = [f32(0)] * NY
for n in range(NT):
    t[n] = f32(n) * DT
    x[n] = f32(1.0) if t[n] < f32(1.0) else f32(0.0)
    h[n] = f32(math.exp(-float(t[n])))
for n in range(NY):
    s = f32(0.0)
    for k in range(NT):
        if 0 <= n - k < NT:
            s = s + x[k] * h[n - k]
    y[n] = s * DT
print("Linear convolution of continuous signals, dt = %.3f" % DT)
for n in range(0, NY, 25):
    print("t = %5.2f   y = %8.5f" % (f32(n) * DT, y[n]))
