"""Python transcription of ~/workspace_v12/fir lowpass/main.c (double DFTs around a 51-tap FIR)."""
import math
import os
import re

header = open(os.path.expanduser("~/workspace_v12/fir lowpass/firlowpass.h")).read()
B = [float(v) for v in re.search(r"B\[\d+\]\s*=\s*\{([^}]*)\}", header).group(1).split(",")]
PI = 3.14159265358979323846
N = 480
FS = 48000.0
F1 = 4800.0
F2 = 16000.0
NTAPS = len(B)


def dft(sig):
    mags = []
    for j in range(N):
        xr = 0.0
        xi = 0.0
        for i in range(N):
            xr = xr + (sig[i] * math.cos(2 * PI * i * j / N))
            xi = xi - (sig[i] * math.sin(2 * PI * i * j / N))
        mags.append(math.sqrt((xr * xr) + (xi * xi)) / N)
    return mags


x = [math.sin(2 * PI * F1 * i / FS) + math.sin(2 * PI * F2 * i / FS) for i in range(N)]
m1 = dft(x)
w = [0.0] * NTAPS
y = []
for i in range(N):
    w = [x[i]] + w[:-1]
    acc = 0.0
    for j in range(NTAPS):
        acc = acc + (B[j] * w[j])
    y.append(acc)
m2 = dft(y)
print("Fs = %.0f Hz, N = %d, taps = %d, bin spacing = %.1f Hz" % (FS, N, NTAPS, FS / N))
print("Input tones: %.0f Hz (bin %.0f) and %.0f Hz (bin %.0f)\n" % (F1, F1 / (FS / N), F2, F2 / (FS / N)))
print("    Hz     |X(f)|      |Y(f)|")
for j in range(N // 2 + 1):
    print("%6.0f  %9.5f  %9.5f" % (j * FS / N, m1[j], m2[j]))
