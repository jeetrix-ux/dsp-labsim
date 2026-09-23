/** Directory shown for LabSim's own headers, e.g. "<builtin>/stdio.h". */
export const BUILTIN_DIR = '<builtin>'

/** Read before every translation unit: cl6x knows the C6000 intrinsics without any #include. */
export const PRELUDE = '__labsim_intrinsics.h'

const SIZE_T = String.raw`#ifndef _LABSIM_SIZE_T
#define _LABSIM_SIZE_T
typedef unsigned int size_t;
#endif`

const NULL_DEF = String.raw`#ifndef NULL
#define NULL 0
#endif`

/** From TI's c6x.h (CGT 8.3), the C62x/C64x/C64x+/C674x intrinsics. */
const INTRINSICS = String.raw`unsigned _extu(unsigned, unsigned, unsigned);
int _ext(int, unsigned, unsigned);
unsigned _set(unsigned, unsigned, unsigned);
unsigned _clr(unsigned, unsigned, unsigned);
unsigned _extur(unsigned, int);
int _extr(int, int);
unsigned _setr(unsigned, int);
unsigned _clrr(unsigned, int);
int _sadd(int, int);
int _ssub(int, int);
int _sshl(int, unsigned);
int _add2(int, int);
int _sub2(int, int);
unsigned _subc(unsigned, unsigned);
unsigned _lmbd(unsigned, unsigned);
int _abs(int);
__int40_t _labs(__int40_t);
unsigned _norm(int);
int _smpy(int, int);
int _smpyhl(int, int);
int _smpylh(int, int);
int _smpyh(int, int);
int _mpy(int, int);
int _mpyus(unsigned, int);
int _mpysu(int, unsigned);
unsigned _mpyu(unsigned, unsigned);
int _mpyhl(int, int);
int _mpyhuls(unsigned, int);
int _mpyhslu(int, unsigned);
unsigned _mpyhlu(unsigned, unsigned);
int _mpylh(int, int);
int _mpyluhs(unsigned, int);
int _mpylshu(int, unsigned);
unsigned _mpylhu(unsigned, unsigned);
int _mpyh(int, int);
int _mpyhus(unsigned, int);
int _mpyhsu(int, unsigned);
unsigned _mpyhu(unsigned, unsigned);
__int40_t _lsadd(int, __int40_t);
__int40_t _lssub(int, __int40_t);
int _sat(__int40_t);
unsigned _lnorm(__int40_t);
double _fabs(double);
float _fabsf(float);
long long _mpyidll(int, int);
int _spint(float);
int _dpint(double);
float _rcpsp(float);
double _rcpdp(double);
float _rsqrsp(float);
double _rsqrdp(double);
unsigned _hi(double);
float _hif(double);
unsigned _hill(long long);
unsigned _lo(double);
float _lof(double);
unsigned _loll(long long);
double _itod(unsigned, unsigned);
double _ftod(float, float);
long long _itoll(unsigned, unsigned);
float _itof(unsigned);
unsigned _ftoi(float);
__int40_t _dtol(double);
double _ltod(__int40_t);
long long _dtoll(double);
double _lltod(long long);
int _add4(int, int);
int _avg2(int, int);
unsigned _avgu4(unsigned, unsigned);
int _cmpeq2(int, int);
int _cmpeq4(int, int);
int _cmpgt2(int, int);
unsigned _cmpgtu4(unsigned, unsigned);
int _dotp2(int, int);
int _dotpn2(int, int);
int _dotpnrsu2(int, unsigned);
int _dotprsu2(int, unsigned);
int _dotpsu4(int, unsigned);
unsigned _dotpu4(unsigned, unsigned);
int _gmpy4(int, int);
__int40_t _ldotp2(int, int);
int _max2(int, int);
unsigned _maxu4(unsigned, unsigned);
int _min2(int, int);
unsigned _minu4(unsigned, unsigned);
long long _mpy2ll(int, int);
long long _mpyhill(int, int);
int _mpyhir(int, int);
long long _mpylill(int, int);
int _mpylir(int, int);
long long _mpysu4ll(int, unsigned);
long long _mpyu4ll(unsigned, unsigned);
unsigned _pack2(unsigned, unsigned);
unsigned _packh2(unsigned, unsigned);
unsigned _packh4(unsigned, unsigned);
unsigned _packhl2(unsigned, unsigned);
unsigned _packl4(unsigned, unsigned);
unsigned _packlh2(unsigned, unsigned);
unsigned _rotl(unsigned, unsigned);
int _sadd2(int, int);
unsigned _saddu4(unsigned, unsigned);
int _saddus2(unsigned, int);
unsigned _shlmb(unsigned, unsigned);
int _shr2(int, unsigned);
unsigned _shrmb(unsigned, unsigned);
unsigned _shru2(unsigned, unsigned);
long long _smpy2ll(int, int);
int _spack2(int, int);
unsigned _spacku4(int, int);
int _sshvl(int, int);
int _sshvr(int, int);
int _sub4(int, int);
int _subabs4(int, int);
int _abs2(int);
unsigned _bitc4(unsigned);
unsigned _bitr(unsigned);
unsigned _deal(unsigned);
int _mvd(int);
unsigned _shfl(unsigned);
unsigned _swap4(unsigned);
unsigned _unpkhu4(unsigned);
unsigned _unpklu4(unsigned);
unsigned _xpnd2(unsigned);
unsigned _xpnd4(unsigned);
long long _addsub(int, int);
long long _addsub2(unsigned, unsigned);
long long _cmpy(unsigned, unsigned);
unsigned _cmpyr(unsigned, unsigned);
unsigned _cmpyr1(unsigned, unsigned);
long long _ddotph2(long long, unsigned);
unsigned _ddotph2r(long long, unsigned);
long long _ddotpl2(long long, unsigned);
unsigned _ddotpl2r(long long, unsigned);
long long _ddotp4(unsigned, unsigned);
long long _dpack2(unsigned, unsigned);
long long _dpackx2(unsigned, unsigned);
long long _dmv(unsigned, unsigned);
double _fdmv(float, float);
unsigned _gmpy(unsigned, unsigned);
long long _mpy32ll(int, int);
int _mpy32(int, int);
long long _mpy32su(int, unsigned);
long long _mpy32us(unsigned, int);
long long _mpy32u(unsigned, unsigned);
long long _mpy2ir(unsigned, int);
unsigned _rpack2(unsigned, unsigned);
long long _saddsub(int, int);
long long _saddsub2(unsigned, unsigned);
long long _shfl3(unsigned, unsigned);
int _smpy32(int, int);
int _ssub2(int, int);
unsigned _xormpy(unsigned, unsigned);
void _nassert(int);`

const CREGISTERS = [
  'AMR', 'CSR', 'IFR', 'ISR', 'ICR', 'IER', 'ISTP', 'IRP', 'NRP', 'GFPGFR', 'DIER', 'FADCR', 'FAUCR', 'FMCR', 'DESR', 'DETR',
  'REP', 'TSCL', 'TSCH', 'ARP', 'ILC', 'RILC', 'PCE1', 'DNUM', 'SSR', 'GPLYA', 'GPLYB', 'TSR', 'ITSR', 'NTSR', 'ECR', 'EFR',
  'IERR', 'DMSG', 'CMSG', 'DT_DMA_ADDR', 'DT_DMA_DATA', 'DT_DMA_CNTL', 'TCU_CNTL', 'RTDX_REC_CNTL'
]

const C6X = String.raw`#ifndef _LABSIM_C6X_H
#define _LABSIM_C6X_H
typedef double __float2_t;
${CREGISTERS.map((r) => `extern __cregister volatile unsigned int ${r};`).join('\n')}
#ifndef _cmplt2
#define _cmplt2(src1, src2) _cmpgt2((src2), (src1))
#endif
#ifndef _cmpltu4
#define _cmpltu4(src1, src2) _cmpgtu4((src2), (src1))
#endif
#ifndef _dotpnrus2
#define _dotpnrus2(src1, src2) _dotpnrsu2((src2), (src1))
#endif
#ifndef _dotpus4
#define _dotpus4(src1, src2) _dotpsu4((src2), (src1))
#endif
#ifndef _mpyihll
#define _mpyihll(src1, src2) _mpyhill((src2), (src1))
#endif
#ifndef _mpyihr
#define _mpyihr(src1, src2) _mpyhir((src2), (src1))
#endif
#ifndef _mpyilll
#define _mpyilll(src1, src2) _mpylill((src2), (src1))
#endif
#ifndef _mpyilr
#define _mpyilr(src1, src2) _mpylir((src2), (src1))
#endif
#ifndef _mpyus4ll
#define _mpyus4ll(src1, src2) _mpysu4ll((src2), (src1))
#endif
#ifndef _saddsu2
#define _saddsu2(src1, src2) _saddus2((src2), (src1))
#endif
#ifndef _swap2
#define _swap2(src) _packlh2((src), (src))
#endif
#define SAVE_AMR(temp_AMR) do { temp_AMR = AMR; AMR = 0; } while (0)
#define RESTORE_AMR(temp_AMR) do { AMR = temp_AMR; } while (0)
#define SAVE_SAT(temp_SAT) do { temp_SAT = _extu(CSR, 22, 31); } while (0)
#define RESTORE_SAT(temp_SAT) do { CSR = _clr(CSR, 9, 9); temp_SAT = _sshl(temp_SAT, 31); } while (0)
#define DATA_IS_ALIGNED_2(x) (_nassert(((unsigned int)(x) & 0x1) == 0))
#define DATA_IS_ALIGNED_4(x) (_nassert(((unsigned int)(x) & 0x3) == 0))
#define DATA_IS_ALIGNED_8(x) (_nassert(((unsigned int)(x) & 0x7) == 0))
#endif`

const MATH_1 = [
  'acos', 'asin', 'atan', 'ceil', 'cos', 'cosh', 'exp', 'fabs', 'floor', 'log', 'log10', 'sin', 'sinh', 'sqrt', 'tan', 'tanh',
  'acosh', 'asinh', 'atanh', 'cbrt', 'erf', 'erfc', 'exp2', 'expm1', 'lgamma', 'log1p', 'log2', 'logb', 'nearbyint', 'rint',
  'round', 'tgamma', 'trunc'
]
const MATH_2 = ['atan2', 'fmod', 'pow', 'copysign', 'fdim', 'fmax', 'fmin', 'hypot', 'nextafter', 'remainder']
const CLASSIFY = ['__fpclassify', '__isfinite', '__isinf', '__isnan', '__isnormal']

function mathDeclarations(): string {
  const out: string[] = []
  for (const [t, s] of [['double', ''], ['float', 'f']]) {
    for (const f of MATH_1) out.push(`${t} ${f}${s}(${t});`)
    for (const f of MATH_2) out.push(`${t} ${f}${s}(${t}, ${t});`)
    out.push(
      `${t} fma${s}(${t}, ${t}, ${t});`,
      `${t} frexp${s}(${t}, int *);`,
      `${t} ldexp${s}(${t}, int);`,
      `${t} modf${s}(${t}, ${t} *);`,
      `${t} remquo${s}(${t}, ${t}, int *);`,
      `${t} scalbn${s}(${t}, int);`,
      `${t} scalbln${s}(${t}, long);`,
      `${t} nan${s}(const char *);`,
      `int ilogb${s}(${t});`,
      `long lrint${s}(${t});`,
      `long lround${s}(${t});`,
      `long long llrint${s}(${t});`,
      `long long llround${s}(${t});`,
      `int __signbit${s}(${t});`
    )
    for (const c of CLASSIFY) out.push(`int ${c}${s}(${t});`)
  }
  for (const c of CLASSIFY) out.push(`int ${c}l(long double);`)
  return out.join('\n')
}

const HEADERS: Record<string, string> = {
  [PRELUDE]: INTRINSICS,

  'assert.h': String.raw`#ifndef _ASSERT
#define _ASSERT
void _assert(int, const char *);
#define _STR(x) __STR(x)
#define __STR(x) #x
#endif
#undef assert
#ifdef NDEBUG
#define assert(_ignore) ((void)0)
#else
#define assert(_expr) _assert((_expr) != 0, "Assertion failed, (" _STR(_expr) "), file " __FILE__ ", line " _STR(__LINE__) "\n")
#endif`,

  'ctype.h': String.raw`#ifndef _LABSIM_CTYPE_H
#define _LABSIM_CTYPE_H
int isalnum(int);
int isalpha(int);
int isascii(int);
int isblank(int);
int iscntrl(int);
int isdigit(int);
int isgraph(int);
int islower(int);
int isprint(int);
int ispunct(int);
int isspace(int);
int isupper(int);
int isxdigit(int);
int toascii(int);
int tolower(int);
int toupper(int);
#endif`,

  'errno.h': String.raw`#ifndef _LABSIM_ERRNO_H
#define _LABSIM_ERRNO_H
extern int errno;
#define EDOM 0x0021
#define ERANGE 0x0022
#define EILSEQ 0x0058
#endif`,

  'float.h': String.raw`#ifndef _LABSIM_FLOAT_H
#define _LABSIM_FLOAT_H
#define FLT_RADIX 2
#define FLT_ROUNDS 1
#define FLT_EVAL_METHOD (-1)
#define FLT_MANT_DIG 24
#define FLT_DIG 6
#define FLT_DECIMAL_DIG 9
#define FLT_MIN_EXP (-125)
#define FLT_MIN_10_EXP (-37)
#define FLT_MAX_EXP 128
#define FLT_MAX_10_EXP 38
#define FLT_EPSILON 1.192092896E-07F
#define FLT_MIN 1.175494351E-38F
#define FLT_MAX 3.402823466E+38F
#define DBL_MANT_DIG 53
#define DBL_DIG 15
#define DBL_DECIMAL_DIG 17
#define DBL_MIN_EXP (-1021)
#define DBL_MIN_10_EXP (-307)
#define DBL_MAX_EXP 1024
#define DBL_MAX_10_EXP 308
#define DBL_EPSILON 2.2204460492503131E-16
#define DBL_MIN 2.2250738585072014E-308
#define DBL_MAX 1.7976931348623157E+308
#define LDBL_MANT_DIG 53
#define LDBL_DIG 15
#define LDBL_DECIMAL_DIG 17
#define LDBL_MIN_EXP (-1021)
#define LDBL_MIN_10_EXP (-307)
#define LDBL_MAX_EXP 1024
#define LDBL_MAX_10_EXP 308
#define LDBL_EPSILON 2.2204460492503131E-16L
#define LDBL_MIN 2.2250738585072014E-308L
#define LDBL_MAX 1.7976931348623157E+308L
#define DECIMAL_DIG (LDBL_DECIMAL_DIG)
#endif`,

  'iso646.h': String.raw`#ifndef _LABSIM_ISO646_H
#define _LABSIM_ISO646_H
#define and &&
#define and_eq &=
#define bitand &
#define bitor |
#define compl ~
#define not !
#define not_eq !=
#define or ||
#define or_eq |=
#define xor ^
#define xor_eq ^=
#endif`,

  'limits.h': String.raw`#ifndef _LABSIM_LIMITS_H
#define _LABSIM_LIMITS_H
#define CHAR_BIT 8
#define SCHAR_MAX 127
#define SCHAR_MIN (-SCHAR_MAX-1)
#define UCHAR_MAX 255
#define CHAR_MAX (SCHAR_MAX)
#define CHAR_MIN (SCHAR_MIN)
#define MB_LEN_MAX 1
#define SHRT_MAX 32767
#define SHRT_MIN (-SHRT_MAX-1)
#define USHRT_MAX 65535
#define INT_MAX 2147483647
#define INT_MIN (-INT_MAX-1)
#define UINT_MAX 4294967295U
#define LONG_MAX 2147483647
#define LONG_MIN (-LONG_MAX-1)
#define ULONG_MAX 4294967295U
#define LLONG_MAX 9223372036854775807
#define LLONG_MIN (-LLONG_MAX-1)
#define ULLONG_MAX 18446744073709551615U
#endif`,

  'math.h': String.raw`#ifndef _LABSIM_MATH_H
#define _LABSIM_MATH_H
#define HUGE_VAL ((double)__INFINITY__)
#define HUGE_VALF (__INFINITY__)
#define HUGE_VALL ((long double)__INFINITY__)
#define INFINITY (__INFINITY__)
#define NAN (__NAN__)
#define FP_INFINITE 1
#define FP_NAN 2
#define FP_NORMAL 3
#define FP_ZERO 4
#define FP_SUBNORMAL 5
#define MATH_ERRNO 1
#define MATH_ERREXCEPT 2
#define math_errhandling (MATH_ERRNO)
#define M_E 2.7182818284590452354
#define M_LOG2E 1.4426950408889634074
#define M_LOG10E 0.43429448190325182765
#define M_LN2 0.69314718055994530942
#define M_LN10 2.30258509299404568402
#define M_PI 3.14159265358979323846
#define M_PI_2 1.57079632679489661923
#define M_PI_4 0.78539816339744830962
#define M_1_PI 0.31830988618379067154
#define M_2_PI 0.63661977236758134308
#define M_2_SQRTPI 1.12837916709551257390
#define M_SQRT2 1.41421356237309504880
#define M_SQRT1_2 0.70710678118654752440
#define fpclassify(x) (sizeof(x) == sizeof(double) ? __fpclassify(x) : sizeof(x) == sizeof(float) ? __fpclassifyf(x) : __fpclassifyl(x))
#define isfinite(x) (sizeof(x) == sizeof(double) ? __isfinite(x) : sizeof(x) == sizeof(float) ? __isfinitef(x) : __isfinitel(x))
#define isinf(x) (sizeof(x) == sizeof(double) ? __isinf(x) : sizeof(x) == sizeof(float) ? __isinff(x) : __isinfl(x))
#define isnan(x) (sizeof(x) == sizeof(double) ? __isnan(x) : sizeof(x) == sizeof(float) ? __isnanf(x) : __isnanl(x))
#define isnormal(x) (sizeof(x) == sizeof(double) ? __isnormal(x) : sizeof(x) == sizeof(float) ? __isnormalf(x) : __isnormall(x))
#define signbit(x) (sizeof(x) == sizeof(float) ? __signbitf(x) : __signbit(x))
#define isunordered(x,y) (isnan(x) || isnan(y))
#define isgreater(x,y) (!isunordered((x), (y)) && (x) > (y))
#define isgreaterequal(x,y) (!isunordered((x), (y)) && (x) >= (y))
#define isless(x,y) (!isunordered((x), (y)) && (x) < (y))
#define islessequal(x,y) (!isunordered((x), (y)) && (x) <= (y))
#define islessgreater(x,y) (!isunordered((x), (y)) && ((x) > (y) || (y) > (x)))
${mathDeclarations()}
#endif`,

  'stdarg.h': String.raw`#ifndef _LABSIM_STDARG_H
#define _LABSIM_STDARG_H
typedef char *va_list;
#define va_start(_ap, _parmN) __builtin_va_start(_ap, _parmN)
#define va_arg(_ap, _type) __builtin_va_arg(_ap, _type)
#define va_end(_ap) ((void)0)
#define va_copy(_dst, _src) ((_dst)=(_src))
#endif`,

  'stdbool.h': String.raw`#ifndef _LABSIM_STDBOOL_H
#define _LABSIM_STDBOOL_H
#define bool _Bool
#define true 1
#define false 0
#define __bool_true_false_are_defined 1
#endif`,

  'stddef.h': String.raw`#ifndef _LABSIM_STDDEF_H
#define _LABSIM_STDDEF_H
${SIZE_T}
typedef int ptrdiff_t;
#ifndef _LABSIM_WCHAR_T
#define _LABSIM_WCHAR_T
typedef unsigned short wchar_t;
#endif
${NULL_DEF}
#define offsetof(_type, _ident) ((size_t)&(((_type *)0)->_ident))
#endif`,

  'stdint.h': String.raw`#ifndef _LABSIM_STDINT_H
#define _LABSIM_STDINT_H
typedef signed char int8_t;
typedef unsigned char uint8_t;
typedef short int16_t;
typedef unsigned short uint16_t;
typedef int int32_t;
typedef unsigned int uint32_t;
typedef long long int64_t;
typedef unsigned long long uint64_t;
typedef signed char int_least8_t;
typedef unsigned char uint_least8_t;
typedef short int_least16_t;
typedef unsigned short uint_least16_t;
typedef int int_least32_t;
typedef unsigned int uint_least32_t;
typedef long long int_least64_t;
typedef unsigned long long uint_least64_t;
typedef int int_fast8_t;
typedef unsigned int uint_fast8_t;
typedef int int_fast16_t;
typedef unsigned int uint_fast16_t;
typedef int int_fast32_t;
typedef unsigned int uint_fast32_t;
typedef long long int_fast64_t;
typedef unsigned long long uint_fast64_t;
typedef int intptr_t;
typedef unsigned int uintptr_t;
typedef long long intmax_t;
typedef unsigned long long uintmax_t;
#define INT8_MIN (-0x7f-1)
#define INT8_MAX 0x7f
#define UINT8_MAX 0xff
#define INT16_MIN (-0x7fff-1)
#define INT16_MAX 0x7fff
#define UINT16_MAX 0xffff
#define INT32_MIN (-0x7fffffff-1)
#define INT32_MAX 0x7fffffff
#define UINT32_MAX 0xffffffffU
#define INT64_MIN (-0x7fffffffffffffffLL-1)
#define INT64_MAX 0x7fffffffffffffffLL
#define UINT64_MAX 0xffffffffffffffffULL
#define INT_LEAST8_MIN INT8_MIN
#define INT_LEAST8_MAX INT8_MAX
#define UINT_LEAST8_MAX UINT8_MAX
#define INT_LEAST16_MIN INT16_MIN
#define INT_LEAST16_MAX INT16_MAX
#define UINT_LEAST16_MAX UINT16_MAX
#define INT_LEAST32_MIN INT32_MIN
#define INT_LEAST32_MAX INT32_MAX
#define UINT_LEAST32_MAX UINT32_MAX
#define INT_LEAST64_MIN INT64_MIN
#define INT_LEAST64_MAX INT64_MAX
#define UINT_LEAST64_MAX UINT64_MAX
#define INT_FAST8_MIN INT32_MIN
#define INT_FAST8_MAX INT32_MAX
#define UINT_FAST8_MAX UINT32_MAX
#define INT_FAST16_MIN INT32_MIN
#define INT_FAST16_MAX INT32_MAX
#define UINT_FAST16_MAX UINT32_MAX
#define INT_FAST32_MIN INT32_MIN
#define INT_FAST32_MAX INT32_MAX
#define UINT_FAST32_MAX UINT32_MAX
#define INT_FAST64_MIN INT64_MIN
#define INT_FAST64_MAX INT64_MAX
#define UINT_FAST64_MAX UINT64_MAX
#define INTPTR_MIN INT32_MIN
#define INTPTR_MAX INT32_MAX
#define UINTPTR_MAX UINT32_MAX
#define INTMAX_MIN INT64_MIN
#define INTMAX_MAX INT64_MAX
#define UINTMAX_MAX UINT64_MAX
#define PTRDIFF_MIN INT32_MIN
#define PTRDIFF_MAX INT32_MAX
#define SIG_ATOMIC_MIN INT32_MIN
#define SIG_ATOMIC_MAX INT32_MAX
#define SIZE_MAX UINT32_MAX
#define RSIZE_MAX (SIZE_MAX >> 1)
#define WINT_MIN 0
#define WINT_MAX INT32_MAX
#define INT8_C(c) ((int_least8_t)(c))
#define UINT8_C(c) ((uint_least8_t)(c))
#define INT16_C(c) ((int_least16_t)(c))
#define UINT16_C(c) ((uint_least16_t)(c))
#define INT32_C(c) ((int_least32_t)(c))
#define UINT32_C(c) ((uint_least32_t)(c))
#define INT64_C(c) ((int_least64_t)(c))
#define UINT64_C(c) ((uint_least64_t)(c))
#define INTMAX_C(c) ((intmax_t)(c))
#define UINTMAX_C(c) ((uintmax_t)(c))
#endif`,

  'stdio.h': String.raw`#ifndef _LABSIM_STDIO_H
#define _LABSIM_STDIO_H
${SIZE_T}
${NULL_DEF}
struct __sFILE {
  int fd;
  unsigned char *buf;
  unsigned char *pos;
  unsigned char *bufend;
  unsigned char *buff_stop;
  unsigned int flags;
};
typedef struct __sFILE FILE;
typedef long fpos_t;
extern FILE _ftable[];
#define stdin (&_ftable[0])
#define stdout (&_ftable[1])
#define stderr (&_ftable[2])
#define EOF (-1)
#define BUFSIZ 256
#define FILENAME_MAX 256
#define TMP_MAX 65535
#define SEEK_SET (0x0000)
#define SEEK_CUR (0x0001)
#define SEEK_END (0x0002)
#define _IOFBF 0x0001
#define _IOLBF 0x0002
#define _IONBF 0x0004
int printf(const char *, ...);
int fprintf(FILE *, const char *, ...);
int sprintf(char *, const char *, ...);
int snprintf(char *, size_t, const char *, ...);
int vprintf(const char *, char *);
int vfprintf(FILE *, const char *, char *);
int vsprintf(char *, const char *, char *);
int vsnprintf(char *, size_t, const char *, char *);
int scanf(const char *, ...);
int fscanf(FILE *, const char *, ...);
int sscanf(const char *, const char *, ...);
int puts(const char *);
int fputs(const char *, FILE *);
int putchar(int);
int fputc(int, FILE *);
int putc(int, FILE *);
int getchar(void);
int fgetc(FILE *);
int getc(FILE *);
char *fgets(char *, int, FILE *);
char *gets(char *);
int ungetc(int, FILE *);
FILE *fopen(const char *, const char *);
FILE *freopen(const char *, const char *, FILE *);
int fclose(FILE *);
int fflush(FILE *);
size_t fread(void *, size_t, size_t, FILE *);
size_t fwrite(const void *, size_t, size_t, FILE *);
int fseek(FILE *, long, int);
long ftell(FILE *);
void rewind(FILE *);
int fgetpos(FILE *, fpos_t *);
int fsetpos(FILE *, const fpos_t *);
int feof(FILE *);
int ferror(FILE *);
void clearerr(FILE *);
int remove(const char *);
int rename(const char *, const char *);
void perror(const char *);
int setvbuf(FILE *, char *, int, size_t);
void setbuf(FILE *, char *);
#endif`,

  'stdlib.h': String.raw`#ifndef _LABSIM_STDLIB_H
#define _LABSIM_STDLIB_H
${SIZE_T}
${NULL_DEF}
#define EXIT_FAILURE 1
#define EXIT_SUCCESS 0
#define MB_CUR_MAX 1
#define RAND_MAX 32767
typedef struct { int quot; int rem; } div_t;
typedef struct { long quot; long rem; } ldiv_t;
typedef struct { long long quot; long long rem; } lldiv_t;
int abs(int);
long labs(long);
long long llabs(long long);
div_t div(int, int);
ldiv_t ldiv(long, long);
lldiv_t lldiv(long long, long long);
int atoi(const char *);
long atol(const char *);
long long atoll(const char *);
double atof(const char *);
long strtol(const char *, char **, int);
unsigned long strtoul(const char *, char **, int);
long long strtoll(const char *, char **, int);
unsigned long long strtoull(const char *, char **, int);
double strtod(const char *, char **);
float strtof(const char *, char **);
int rand(void);
void srand(unsigned int);
void *malloc(size_t);
void *calloc(size_t, size_t);
void *realloc(void *, size_t);
void free(void *);
void *memalign(size_t, size_t);
void exit(int);
void abort(void);
int atexit(void (*)(void));
void qsort(void *, size_t, size_t, int (*)(const void *, const void *));
void *bsearch(const void *, const void *, size_t, size_t, int (*)(const void *, const void *));
char *getenv(const char *);
int system(const char *);
#endif`,

  'string.h': String.raw`#ifndef _LABSIM_STRING_H
#define _LABSIM_STRING_H
${SIZE_T}
${NULL_DEF}
void *memcpy(void *, const void *, size_t);
void *memmove(void *, const void *, size_t);
void *memset(void *, int, size_t);
int memcmp(const void *, const void *, size_t);
void *memchr(const void *, int, size_t);
char *strcpy(char *, const char *);
char *strncpy(char *, const char *, size_t);
char *strcat(char *, const char *);
char *strncat(char *, const char *, size_t);
int strcmp(const char *, const char *);
int strncmp(const char *, const char *, size_t);
int strcoll(const char *, const char *);
size_t strxfrm(char *, const char *, size_t);
char *strchr(const char *, int);
char *strrchr(const char *, int);
char *strstr(const char *, const char *);
char *strpbrk(const char *, const char *);
size_t strspn(const char *, const char *);
size_t strcspn(const char *, const char *);
char *strtok(char *, const char *);
size_t strlen(const char *);
char *strerror(int);
#endif`,

  'time.h': String.raw`#ifndef _LABSIM_TIME_H
#define _LABSIM_TIME_H
${SIZE_T}
${NULL_DEF}
typedef unsigned int clock_t;
typedef unsigned int time_t;
struct tm {
  int tm_sec;
  int tm_min;
  int tm_hour;
  int tm_mday;
  int tm_mon;
  int tm_year;
  int tm_wday;
  int tm_yday;
  int tm_isdst;
};
/* The LCDK's C6748 runs at 300 MHz; clock() counts CPU cycles. */
#define CLOCKS_PER_SEC ((clock_t)300000000)
clock_t clock(void);
time_t time(time_t *);
double difftime(time_t, time_t);
time_t mktime(struct tm *);
char *asctime(const struct tm *);
char *ctime(const time_t *);
struct tm *gmtime(const time_t *);
struct tm *localtime(const time_t *);
size_t strftime(char *, size_t, const char *, const struct tm *);
#endif`,

  'c6x.h': C6X
}

for (const h of ['complex.h', 'fenv.h', 'inttypes.h', 'locale.h', 'setjmp.h', 'signal.h', 'tgmath.h', 'wchar.h', 'wctype.h']) {
  HEADERS[h] = `#error LabSim does not support <${h}> yet`
}

export const BUILTIN_HEADERS: Readonly<Record<string, string>> = HEADERS
