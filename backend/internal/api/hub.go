package api

import (
	"sync"

	"github.com/ismaelosuna/saveme/backend/internal/store"
)

// subscriberBuffer es cuántos eventos puede acumular un cliente antes de que se
// le considere atrasado.
const subscriberBuffer = 64

// hub reparte eventos a los clientes SSE conectados.
//
// Política ante un cliente lento: cuando su buffer se llena, se le cierra la
// conexión en vez de descartar eventos en silencio. El EventSource del navegador
// reconecta solo y manda Last-Event-ID, así que el cliente se resincroniza por
// el camino normal. Descartar eventos sin avisar dejaría la interfaz mostrando
// datos viejos sin que nadie se entere.
type hub struct {
	mu   sync.Mutex
	subs map[*subscriber]struct{}
}

type subscriber struct {
	ch     chan store.Event
	closed bool
}

func newHub() *hub {
	return &hub{subs: make(map[*subscriber]struct{})}
}

// subscribe registra un cliente. Devuelve el canal de eventos y la función para
// darse de baja.
func (h *hub) subscribe() (<-chan store.Event, func()) {
	sub := &subscriber{ch: make(chan store.Event, subscriberBuffer)}

	h.mu.Lock()
	h.subs[sub] = struct{}{}
	h.mu.Unlock()

	cancel := func() {
		h.mu.Lock()
		defer h.mu.Unlock()
		if !sub.closed {
			sub.closed = true
			close(sub.ch)
		}
		delete(h.subs, sub)
	}
	return sub.ch, cancel
}

// broadcast envía un evento a todos los clientes vivos.
func (h *hub) broadcast(ev store.Event) {
	h.mu.Lock()
	defer h.mu.Unlock()

	for sub := range h.subs {
		if sub.closed {
			continue
		}
		select {
		case sub.ch <- ev:
		default:
			// Cliente atrasado: se le cierra la conexión para que reconecte y
			// recupere lo perdido desde Last-Event-ID.
			sub.closed = true
			close(sub.ch)
			delete(h.subs, sub)
		}
	}
}

// subscribers devuelve cuántos clientes hay conectados. Se usa en las pruebas y
// en el log de arranque.
func (h *hub) subscribers() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.subs)
}
