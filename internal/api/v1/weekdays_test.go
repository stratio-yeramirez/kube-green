package v1

import (
	"testing"

	"github.com/stretchr/testify/require"
)

// Los días de la semana viajan entre tres representaciones: lo que el usuario escribe en la
// interfaz ("lunes-viernes"), la notación cron que guarda el SleepInfo ("1-5") y la lista de
// números con la que se calcula el desplazamiento de día al convertir entre zonas horarias.
// Un error aquí adelanta o atrasa un día entero el apagado de un tenant.

func TestHumanWeekdaysToKube(t *testing.T) {
	casos := []struct {
		nombre   string
		entrada  string
		esperado string
		conError bool
	}{
		{nombre: "vacio son todos los dias", entrada: "", esperado: "0-6"},
		// Un rango escrito con palabras se expande a lista; solo la notación numérica se
		// conserva tal cual.
		{nombre: "laborables en castellano", entrada: "lunes-viernes", esperado: "1,2,3,4,5"},
		{nombre: "con acento", entrada: "miércoles", esperado: "3"},
		{nombre: "sin acento", entrada: "miercoles", esperado: "3"},
		{nombre: "mayusculas", entrada: "LUNES", esperado: "1"},
		{nombre: "lista", entrada: "lunes,miercoles,viernes", esperado: "1,3,5"},
		{nombre: "domingo es cero", entrada: "domingo", esperado: "0"},
		{nombre: "numerico se respeta", entrada: "1-5", esperado: "1-5"},
		{nombre: "numerico con espacios", entrada: "1, 3, 5", esperado: "1,3,5"},
		{nombre: "dia inexistente", entrada: "lunez", conError: true},
	}

	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			resultado, err := HumanWeekdaysToKube(c.entrada)
			if c.conError {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			require.Equal(t, c.esperado, resultado)
		})
	}
}

func TestExpandWeekdaysStr(t *testing.T) {
	casos := []struct {
		nombre   string
		entrada  string
		esperado []int
	}{
		{nombre: "vacio son todos", entrada: "", esperado: []int{0, 1, 2, 3, 4, 5, 6}},
		{nombre: "rango", entrada: "1-5", esperado: []int{1, 2, 3, 4, 5}},
		{nombre: "lista", entrada: "1,3,5", esperado: []int{1, 3, 5}},
		{nombre: "un solo dia", entrada: "6", esperado: []int{6}},
		{nombre: "texto en castellano", entrada: "lunes-viernes", esperado: []int{1, 2, 3, 4, 5}},
		{nombre: "el ciclo de sleep del cluster", entrada: "2-6", esperado: []int{2, 3, 4, 5, 6}},
	}

	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			resultado, err := ExpandWeekdaysStr(c.entrada)
			require.NoError(t, err)
			require.Equal(t, c.esperado, resultado)
		})
	}
}

// TestShiftWeekdaysStr cubre el desplazamiento de día que se aplica cuando la hora local del
// usuario cae en un día distinto en UTC. Es lo que hace que un apagado a las 21:30 de Bogotá
// de lunes a viernes quede registrado como de martes a sábado en el cluster.
func TestShiftWeekdaysStr(t *testing.T) {
	casos := []struct {
		nombre   string
		entrada  string
		shift    int
		esperado string
	}{
		{nombre: "sin desplazamiento", entrada: "1-5", shift: 0, esperado: "1,2,3,4,5"},
		{nombre: "un dia adelante", entrada: "1-5", shift: 1, esperado: "2,3,4,5,6"},
		{nombre: "un dia atras", entrada: "2-6", shift: -1, esperado: "1,2,3,4,5"},
		{nombre: "el sabado pasa a domingo", entrada: "6", shift: 1, esperado: "0"},
		{nombre: "el domingo retrocede a sabado", entrada: "0", shift: -1, esperado: "6"},
		{nombre: "una semana completa no cambia nada", entrada: "1,3,5", shift: 7, esperado: "1,3,5"},
		{nombre: "todos los dias siguen siendo todos", entrada: "0-6", shift: 3, esperado: "3,4,5,6,0,1,2"},
	}

	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			resultado, err := ShiftWeekdaysStr(c.entrada, c.shift)
			require.NoError(t, err)
			require.Equal(t, c.esperado, resultado)
		})
	}
}

// TestShiftWeekdaysIdaYVuelta comprueba que desplazar y deshacer el desplazamiento devuelve
// los días originales, que es lo que permite mostrar en la interfaz los mismos días que el
// usuario configuró aunque en el cluster estén guardados corridos.
func TestShiftWeekdaysIdaYVuelta(t *testing.T) {
	for _, dias := range []string{"1-5", "0-6", "1,3,5", "6", "0"} {
		for _, shift := range []int{-1, 0, 1} {
			ida, err := ShiftWeekdaysStr(dias, shift)
			require.NoError(t, err)
			vuelta, err := ShiftWeekdaysStr(ida, -shift)
			require.NoError(t, err)

			original, err := ExpandWeekdaysStr(dias)
			require.NoError(t, err)
			recuperado, err := ExpandWeekdaysStr(vuelta)
			require.NoError(t, err)
			require.ElementsMatch(t, original, recuperado,
				"dias=%s shift=%d", dias, shift)
		}
	}
}

func TestNormalizeNamespaces(t *testing.T) {
	t.Run("sin entrada no selecciona ninguno", func(t *testing.T) {
		require.Empty(t, normalizeNamespaces(nil))
		require.Empty(t, normalizeNamespaces([]string{}))
	})

	t.Run("normaliza mayusculas y espacios", func(t *testing.T) {
		resultado := normalizeNamespaces([]string{" Datastores ", "APPS"})
		require.True(t, resultado["datastores"])
		require.True(t, resultado["apps"])
	})

	t.Run("descarta entradas vacias", func(t *testing.T) {
		resultado := normalizeNamespaces([]string{"apps", "", "  "})
		require.Len(t, resultado, 1)
		require.True(t, resultado["apps"])
	})
}

func TestIsNamespaceSelected(t *testing.T) {
	seleccionados := normalizeNamespaces([]string{"datastores", "apps"})

	require.True(t, isNamespaceSelected(seleccionados, "datastores"))
	require.True(t, isNamespaceSelected(seleccionados, "apps"))
	require.False(t, isNamespaceSelected(seleccionados, "rocket"))
}
