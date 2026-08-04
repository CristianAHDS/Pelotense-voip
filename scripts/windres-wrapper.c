#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static const char *REAL_WINDRES =
    "C:\\Users\\tsicr\\AppData\\Local\\Microsoft\\WinGet\\Packages\\"
    "MartinStorsjo.LLVM-MinGW.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe\\"
    "llvm-mingw-20260616-ucrt-x86_64\\bin\\windres.exe";

int main(int argc, char **argv) {
    char *input = NULL;
    int i;

    for (i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--input") == 0 && i + 1 < argc) {
            input = argv[i + 1];
            i++;
        }
    }

    if (!input) {
        argv[0] = (char *)REAL_WINDRES;
        return _spawnvp(_P_WAIT, REAL_WINDRES, (const char *const *)argv);
    }

    FILE *f = fopen(input, "rb");
    if (!f) {
        fprintf(stderr, "windres-wrapper: cannot open %s\n", input);
        return 1;
    }
    fseek(f, 0, SEEK_END);
    long n = ftell(f);
    fseek(f, 0, SEEK_SET);
    char *buf = (char *)malloc((size_t)n + 1);
    if (!buf) { fclose(f); return 1; }
    fread(buf, 1, (size_t)n, f);
    fclose(f);
    buf[n] = 0;

    static const char pat[] = "\\\\\\\\?\\\\";
    const size_t plen = sizeof(pat) - 1;
    char *out = (char *)malloc((size_t)n + 1);
    char *o = out;
    char *p = buf;
    char *end = buf + n;
    int changed = 0;
    while (p < end) {
        if ((size_t)(end - p) >= plen && memcmp(p, pat, plen) == 0) {
            p += plen;
            changed = 1;
        } else {
            *o++ = *p++;
        }
    }
    *o = 0;

    if (!changed) {
        free(out);
        argv[0] = (char *)REAL_WINDRES;
        return _spawnvp(_P_WAIT, REAL_WINDRES, (const char *const *)argv);
    }

    char *tmp = (char *)malloc(strlen(input) + 8);
    sprintf(tmp, "%s.fixed", input);
    FILE *g = fopen(tmp, "wb");
    if (!g) { fprintf(stderr, "windres-wrapper: cannot write %s\n", tmp); return 1; }
    fwrite(out, 1, (size_t)(o - out), g);
    fclose(g);

    for (i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--input") == 0 && i + 1 < argc) {
            argv[i + 1] = tmp;
            i++;
        }
    }
    argv[0] = (char *)REAL_WINDRES;
    return _spawnvp(_P_WAIT, REAL_WINDRES, (const char *const *)argv);
}
