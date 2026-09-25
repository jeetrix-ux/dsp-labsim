/* C6748.cmd - linker command file written for DSP LabSim.                   */
/* Memory map of the TMS320C6748 (SPRS590); every section goes to the 128 kB */
/* shared RAM, which is what the LCDK lab projects use.                      */

MEMORY
{
    DSPL2ROM     o = 0x00700000  l = 0x00100000   /* 1 MB L2 ROM              */
    DSPL2RAM     o = 0x00800000  l = 0x00040000   /* 256 kB L2 RAM            */
    DSPL1PRAM    o = 0x00E00000  l = 0x00008000   /* 32 kB L1 program RAM     */
    DSPL1DRAM    o = 0x00F00000  l = 0x00008000   /* 32 kB L1 data RAM        */
    SHDSPL2ROM   o = 0x11700000  l = 0x00100000   /* L2 ROM, global address   */
    SHDSPL2RAM   o = 0x11800000  l = 0x00040000   /* L2 RAM, global address   */
    SHDSPL1PRAM  o = 0x11E00000  l = 0x00008000   /* L1P RAM, global address  */
    SHDSPL1DRAM  o = 0x11F00000  l = 0x00008000   /* L1D RAM, global address  */
    EMIFACS0     o = 0x40000000  l = 0x20000000   /* EMIFA CS0, 512 MB SDRAM  */
    EMIFACS2     o = 0x60000000  l = 0x02000000   /* EMIFA CS2, 32 MB async   */
    EMIFACS3     o = 0x62000000  l = 0x02000000   /* EMIFA CS3, 32 MB async   */
    EMIFACS4     o = 0x64000000  l = 0x02000000   /* EMIFA CS4, 32 MB async   */
    EMIFACS5     o = 0x66000000  l = 0x02000000   /* EMIFA CS5, 32 MB async   */
    SHRAM        o = 0x80000000  l = 0x00020000   /* 128 kB shared RAM        */
    DDR2         o = 0xC0000000  l = 0x20000000   /* 512 MB DDR2              */
}

SECTIONS
{
    .text          > SHRAM
    .stack         > SHRAM
    .bss           > SHRAM
    .cio           > SHRAM
    .const         > SHRAM
    .data          > SHRAM
    .switch        > SHRAM
    .sysmem        > SHRAM
    .far           > SHRAM
    .args          > SHRAM
    .ppinfo        > SHRAM
    .ppdata        > SHRAM
    .pinit         > SHRAM
    .cinit         > SHRAM
    .binit         > SHRAM
    .init_array    > SHRAM
    .neardata      > SHRAM
    .fardata       > SHRAM
    .rodata        > SHRAM
    .c6xabi.exidx  > SHRAM
    .c6xabi.extab  > SHRAM
}
