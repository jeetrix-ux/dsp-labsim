#include <stdio.h>
float x[64];
float h[3] = { 1.0f, 2.0f, 1.0f };
static int counter;
static const short table[4] = { 1, 2, 3, 4 };
double big[2000];
struct pt { int a; float b; } pts[5];
int main(void)
{
    static float local_static[8];
    float local[16];
    int i;
    for (i = 0; i < 16; i++) local[i] = i;
    local_static[0] = local[3] + x[0] + h[1] + table[2] + counter + big[1] + pts[0].b;
    printf("%f\n", local_static[0]);
    return 0;
}
