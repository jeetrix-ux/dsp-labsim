"""Python transcription of ~/workspace_v12/exp11/main.c (radix-2 FFT in float)."""
import math
import numpy as np

f32 = np.float32
N = 8
PI = 3.14159265358979323846
xr = [f32(v) for v in (1, 2, 3, 4, 0, 0, 0, 0)]
xi = [f32(0)] * N
j = 0
for i in range(1, N - 1):
    m = N // 2
    while j >= m:
        j -= m
        m //= 2
    j += m
    if i < j:
        xr[i], xr[j] = xr[j], xr[i]
        xi[i], xi[j] = xi[j], xi[i]
m = 2
while m <= N:
    ang = f32(-2 * PI / m)
    for k in range(0, N, m):
        for jj in range(m // 2):
            wr = f32(math.cos(float(f32(jj) * ang)))
            wi = f32(math.sin(float(f32(jj) * ang)))
            a = k + jj + m // 2
            tr = wr * xr[a] - wi * xi[a]
            ti = wr * xi[a] + wi * xr[a]
            xr[a] = xr[k + jj] - tr
            xi[a] = xi[k + jj] - ti
            xr[k + jj] = xr[k + jj] + tr
            xi[k + jj] = xi[k + jj] + ti
    m *= 2
print("k\tReal\tImag\tMagnitude\tPhase")
for i in range(N):
    mag = f32(math.sqrt(float(xr[i] * xr[i] + xi[i] * xi[i])))
    phase = f32(math.atan2(float(xi[i]), float(xr[i])))
    print("%d\t%f\t%f\t%f\t%f" % (i, xr[i], xi[i], mag, phase))
