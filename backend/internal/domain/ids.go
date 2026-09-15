// Package domain contiene los tipos y reglas de negocio de SaveMe, sin
// dependencias de infraestructura (ni disco, ni SQL, ni HTTP).
package domain

import (
	"crypto/rand"
	"encoding/binary"
	"strings"
	"time"
)

// crockford es el alfabeto de ULID: base32 sin caracteres ambiguos (I, L, O, U).
const crockford = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

// NewID genera un identificador con prefijo "sm_".
//
// Es un ULID: 48 bits de timestamp en milisegundos seguidos de 80 bits
// aleatorios, codificados en 26 caracteres base32. El resultado ordena
// lexicográficamente por fecha de creación, lo que permite usar el ID como
// criterio de orden estable sin consultar created_at.
func NewID() string {
	var b [16]byte
	ms := uint64(time.Now().UnixMilli())
	b[0] = byte(ms >> 40)
	b[1] = byte(ms >> 32)
	b[2] = byte(ms >> 24)
	b[3] = byte(ms >> 16)
	b[4] = byte(ms >> 8)
	b[5] = byte(ms)
	// crypto/rand.Read nunca devuelve error en las plataformas soportadas.
	_, _ = rand.Read(b[6:])
	return "sm_" + strings.ToLower(encodeULID(b))
}

// NewToken genera el token de un solo uso que liga una propuesta con su
// confirmación. 160 bits de entropía: suficiente para que adivinar un token
// sea inviable y para que no colisione con ningún otro.
func NewToken() string {
	var b [20]byte
	_, _ = rand.Read(b[:])
	return "pt_" + strings.ToLower(encodeBase32(b[:]))
}

// encodeULID codifica 16 bytes en los 26 caracteres canónicos de un ULID.
func encodeULID(b [16]byte) string {
	var out [26]byte
	out[0] = crockford[(b[0]&224)>>5]
	out[1] = crockford[b[0]&31]
	out[2] = crockford[(b[1]&248)>>3]
	out[3] = crockford[((b[1]&7)<<2)|((b[2]&192)>>6)]
	out[4] = crockford[(b[2]&62)>>1]
	out[5] = crockford[((b[2]&1)<<4)|((b[3]&240)>>4)]
	out[6] = crockford[((b[3]&15)<<1)|((b[4]&128)>>7)]
	out[7] = crockford[(b[4]&124)>>2]
	out[8] = crockford[((b[4]&3)<<3)|((b[5]&224)>>5)]
	out[9] = crockford[b[5]&31]
	out[10] = crockford[(b[6]&248)>>3]
	out[11] = crockford[((b[6]&7)<<2)|((b[7]&192)>>6)]
	out[12] = crockford[(b[7]&62)>>1]
	out[13] = crockford[((b[7]&1)<<4)|((b[8]&240)>>4)]
	out[14] = crockford[((b[8]&15)<<1)|((b[9]&128)>>7)]
	out[15] = crockford[(b[9]&124)>>2]
	out[16] = crockford[((b[9]&3)<<3)|((b[10]&224)>>5)]
	out[17] = crockford[b[10]&31]
	out[18] = crockford[(b[11]&248)>>3]
	out[19] = crockford[((b[11]&7)<<2)|((b[12]&192)>>6)]
	out[20] = crockford[(b[12]&62)>>1]
	out[21] = crockford[((b[12]&1)<<4)|((b[13]&240)>>4)]
	out[22] = crockford[((b[13]&15)<<1)|((b[14]&128)>>7)]
	out[23] = crockford[(b[14]&124)>>2]
	out[24] = crockford[((b[14]&3)<<3)|((b[15]&224)>>5)]
	out[25] = crockford[b[15]&31]
	return string(out[:])
}

// encodeBase32 codifica bytes arbitrarios en base32 Crockford, rellenando con
// ceros a la izquierda hasta completar el último carácter.
func encodeBase32(b []byte) string {
	var sb strings.Builder
	var acc uint32
	var bits uint
	for _, c := range b {
		acc = (acc << 8) | uint32(c)
		bits += 8
		for bits >= 5 {
			bits -= 5
			sb.WriteByte(crockford[(acc>>bits)&31])
		}
	}
	if bits > 0 {
		sb.WriteByte(crockford[(acc<<(5-bits))&31])
	}
	return sb.String()
}

// Uint64ToBytes se usa en pruebas para construir payloads deterministas.
func Uint64ToBytes(v uint64) []byte {
	var b [8]byte
	binary.BigEndian.PutUint64(b[:], v)
	return b[:]
}
