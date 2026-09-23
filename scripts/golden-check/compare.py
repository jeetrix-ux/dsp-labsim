"""Compares a LabSim golden transcript with a Python transcription of the same program.

Words must match exactly; numbers must agree to within one unit of the last digit the golden prints (TI's printf
rounds half-up on a generated digit, Python rounds exactly, so the last digit may differ by one).
"""
import re
import sys

NUMBER = re.compile(r"^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$")


def tokens(text):
    lines = []
    for line in text.replace("\r\n", "\n").split("\n"):
        if line.startswith("@@ labsim: "):
            break
        lines.append(line)
    return re.findall(r"[-+]?\d+\.?\d*(?:[eE][-+]?\d+)?|[A-Za-z_]+|\S", "\n".join(lines))


def tolerance(tok):
    mantissa = re.split(r"[eE]", tok)[0]
    decimals = len(mantissa.split(".")[1]) if "." in mantissa else 0
    scale = 10 ** int(re.split(r"[eE]", tok)[1]) if re.search(r"[eE]", tok) else 1
    return 1.01 * 10 ** -decimals * scale


def main(golden_path, python_path):
    golden = tokens(open(golden_path, encoding="latin-1").read())
    python = tokens(open(python_path, encoding="latin-1").read())
    if len(golden) != len(python):
        print(f"token count differs: golden {len(golden)}, python {len(python)}")
        return 1
    bad = 0
    for g, p in zip(golden, python):
        if NUMBER.match(g) and NUMBER.match(p):
            if abs(float(g) - float(p)) > tolerance(g):
                print(f"number differs: golden {g}, python {p}")
                bad += 1
        elif g != p:
            print(f"text differs: golden {g!r}, python {p!r}")
            bad += 1
    print("match" if bad == 0 else f"{bad} differences")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1], sys.argv[2]))
