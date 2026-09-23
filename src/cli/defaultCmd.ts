/** MEMORY and SECTIONS of CCS's C6748.cmd template (ccs_base/c6000/include), for programs without a .cmd file. */
export const DEFAULT_CMD = `MEMORY
{
    DSPL2ROM     o = 0x00700000  l = 0x00100000
    DSPL2RAM     o = 0x00800000  l = 0x00040000
    DSPL1PRAM    o = 0x00E00000  l = 0x00008000
    DSPL1DRAM    o = 0x00F00000  l = 0x00008000
    SHDSPL2ROM   o = 0x11700000  l = 0x00100000
    SHDSPL2RAM   o = 0x11800000  l = 0x00040000
    SHDSPL1PRAM  o = 0x11E00000  l = 0x00008000
    SHDSPL1DRAM  o = 0x11F00000  l = 0x00008000
    EMIFACS0     o = 0x40000000  l = 0x20000000
    EMIFACS2     o = 0x60000000  l = 0x02000000
    EMIFACS3     o = 0x62000000  l = 0x02000000
    EMIFACS4     o = 0x64000000  l = 0x02000000
    EMIFACS5     o = 0x66000000  l = 0x02000000
    SHRAM        o = 0x80000000  l = 0x00020000
    DDR2         o = 0xC0000000  l = 0x20000000
}
SECTIONS
{
    .text          >  SHRAM
    .stack         >  SHRAM
    .bss           >  SHRAM
    .cio           >  SHRAM
    .const         >  SHRAM
    .data          >  SHRAM
    .switch        >  SHRAM
    .sysmem        >  SHRAM
    .far           >  SHRAM
    .args          >  SHRAM
    .ppinfo        >  SHRAM
    .ppdata        >  SHRAM
    .pinit         >  SHRAM
    .cinit         >  SHRAM
    .binit         >  SHRAM
    .init_array    >  SHRAM
    .neardata      >  SHRAM
    .fardata       >  SHRAM
    .rodata        >  SHRAM
    .c6xabi.exidx  >  SHRAM
    .c6xabi.extab  >  SHRAM
}
`
