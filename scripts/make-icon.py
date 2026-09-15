#!/usr/bin/env python3
"""Genera el icono de SaveMe.

Se hace con matemática de píxeles y la librería estándar (zlib + struct) en vez
de con una herramienta gráfica o Pillow: así el icono es reproducible desde el
repositorio, sin binarios intermedios ni dependencias que instalar.

El motivo es el prompt de una terminal: un chevron ámbar y un cursor, sobre el
mismo fondo casi negro que usa la aplicación. Las esquinas van **transparentes**,
no negras: un cuadrado negro alrededor del icono se ve como un recorte sucio en
el Dock y en Finder.

Uso:
    python3 scripts/make-icon.py [salida.png] [tamaño]
"""

import struct
import sys
import zlib

# Paleta, idéntica a la de la aplicación.
BG = (11, 14, 15)        # #0b0e0f
BORDER = (30, 42, 46)    # #1e2a2e
AMBER = (255, 180, 84)   # #ffb454
DIM_AMBER = (127, 216, 143)  # #7fd88f, para el cursor

# Supersampling: se dibuja al doble y se promedia, para bordes suaves sin
# necesidad de calcular antialiasing analítico.
SS = 2


def rounded_rect_coverage(x, y, left, top, right, bottom, radius):
    """1.0 dentro del rectángulo redondeado, 0.0 fuera."""
    if x < left or x > right or y < top or y > bottom:
        return 0.0
    cx = min(max(x, left + radius), right - radius)
    cy = min(max(y, top + radius), bottom - radius)
    if (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2:
        return 1.0
    return 0.0


def segment_distance(px, py, ax, ay, bx, by):
    """Distancia de un punto al segmento AB."""
    dx, dy = bx - ax, by - ay
    length_sq = dx * dx + dy * dy
    if length_sq == 0:
        return ((px - ax) ** 2 + (py - ay) ** 2) ** 0.5
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / length_sq))
    qx, qy = ax + t * dx, ay + t * dy
    return ((px - qx) ** 2 + (py - qy) ** 2) ** 0.5


def blend(base, top, alpha):
    return tuple(int(round(b + (t - b) * alpha)) for b, t in zip(base, top))


def render(size):
    """Devuelve las filas RGBA del icono a ese tamaño.

    Fuera del rectángulo redondeado el alpha es 0. El icono es una loseta con las
    esquinas recortadas, **no** un cuadrado: si el exterior se pintara opaco (que
    es lo que hacía antes, en negro), macOS enseñaría un cuadrado negro alrededor
    del icono.

    Los canales se acumulan **premultiplicados** por el alpha y se deshacen al
    final. Promediar RGBA en alpha directo arrastraría el color hacia el negro en
    el borde: un píxel medio dentro y medio fuera saldría casi negro con alpha al
    50%, en vez del color del borde con alpha al 50%.
    """
    hi = size * SS
    rows = []

    # Geometría en fracciones del lado, para que escale a cualquier tamaño.
    radius = 0.22 * hi
    border_w = 0.012 * hi
    chevron_w = 0.055 * hi

    # Chevron ">": dos trazos que se encuentran en el vértice.
    ax, ay = 0.34 * hi, 0.30 * hi
    bx, by = 0.62 * hi, 0.50 * hi
    cx, cy = 0.34 * hi, 0.70 * hi

    # Cursor "_", por debajo del vértice del chevron para que no se toquen.
    cur_l, cur_r = 0.42 * hi, 0.74 * hi
    cur_t, cur_b = 0.745 * hi, 0.795 * hi

    for oy in range(size):
        row = bytearray()
        for ox in range(size):
            # r*a, g*a, b*a, a  (a en 0..255)
            acc = [0.0, 0.0, 0.0, 0.0]
            for sy in range(SS):
                for sx in range(SS):
                    x = ox * SS + sx + 0.5
                    y = oy * SS + sy + 0.5

                    if rounded_rect_coverage(x, y, 0, 0, hi, hi, radius) == 0.0:
                        # Fuera de la loseta: transparente, no negro.
                        continue

                    # Fondo, con un borde interior tenue.
                    outer = rounded_rect_coverage(
                        x, y, border_w, border_w,
                        hi - border_w, hi - border_w, radius - border_w
                    )
                    color = BG if outer > 0 else BORDER

                    # Chevron.
                    d1 = segment_distance(x, y, ax, ay, bx, by)
                    d2 = segment_distance(x, y, bx, by, cx, cy)
                    if min(d1, d2) <= chevron_w / 2:
                        color = AMBER
                    else:
                        # Suavizado del trazo, en el borde exterior del chevron.
                        edge = min(d1, d2) - chevron_w / 2
                        if 0 < edge < SS:
                            color = blend(color, AMBER, 1.0 - (edge / SS))

                    # Cursor, dibujado encima.
                    if rounded_rect_coverage(x, y, cur_l, cur_t, cur_r, cur_b, border_w) > 0:
                        color = DIM_AMBER

                    for i in range(3):
                        acc[i] += color[i]
                    acc[3] += 255.0

            total = SS * SS
            alpha = acc[3] / total
            if alpha <= 0:
                row.extend((0, 0, 0, 0))
            else:
                # Se deshace la premultiplicación repartiendo el color solo entre
                # las muestras que aportaron alpha.
                peso = acc[3] / 255.0
                row.extend((
                    int(round(acc[0] / peso)),
                    int(round(acc[1] / peso)),
                    int(round(acc[2] / peso)),
                    int(round(alpha)),
                ))
        rows.append(bytes(row))
    return rows


def write_png(path, size, rows):
    raw = b"".join(b"\x00" + row for row in rows)

    def chunk(tag, data):
        body = struct.pack(">I", len(data)) + tag + data
        return body + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    # Tipo de color 6 = RGBA. Con el 2 (RGB) no hay canal alpha y las esquinas
    # salen negras y opacas por mucho que se pinten de negro: el fondo del icono
    # tiene que poder ser transparente.
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as fh:
        fh.write(png)


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "src-tauri/icons/icon.png"
    size = int(sys.argv[2]) if len(sys.argv) > 2 else 1024
    write_png(out, size, render(size))
    print(f"icono escrito en {out} ({size}x{size})")


if __name__ == "__main__":
    main()
