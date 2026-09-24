package v1

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"
)

// El encendido escalonado es la capacidad que evita que las aplicaciones de un tenant
// arranquen antes que sus bases de datos y entren en bucle de reinicios. Depende de tres
// piezas que tienen que seguir encajando entre sí:
//
//  1. El contrato JSON de DelayConfig, que es lo que el frontend envía.
//  2. El cálculo de las horas escalonadas a partir de la hora base.
//  3. La lectura de los delays ya configurados, para no perderlos al reeditar un horario.
//
// Estos tests fijan las tres.

// TestDelayConfigJSONContract fija los nombres de los campos que viajan en el JSON.
// El frontend construye el payload con estas claves exactas; renombrar un campo de Go sin
// tocar el frontend hace que el backend reciba delays vacíos, aplique sus valores por
// defecto y deje todos los SleepInfo del tenant a la misma hora.
func TestDelayConfigJSONContract(t *testing.T) {
	data, err := json.Marshal(DelayConfig{
		PgHdfsDelay:      "0m",
		PgbouncerDelay:   "5m",
		DeploymentsDelay: "10m",
	})
	require.NoError(t, err)

	var decoded map[string]string
	require.NoError(t, json.Unmarshal(data, &decoded))

	require.Equal(t, map[string]string{
		"pgHdfsDelay":      "0m",
		"pgbouncerDelay":   "5m",
		"deploymentsDelay": "10m",
	}, decoded, "el frontend envía estas claves; si cambian, los delays se pierden en silencio")
}

// TestDelayConfigIgnoraClavesDesconocidas documenta el fallo que provoca el desajuste de
// contrato: un payload con nombres que el backend no conoce se deserializa sin error y deja
// la configuración vacía, de modo que el escalonado se pierde sin que nadie se entere.
func TestDelayConfigIgnoraClavesDesconocidas(t *testing.T) {
	payload := []byte(`{"suspendDeploymentsPgbouncer":"5m","suspendDeployments":"10m"}`)

	var delays DelayConfig
	require.NoError(t, json.Unmarshal(payload, &delays))

	require.Empty(t, delays.PgbouncerDelay)
	require.Empty(t, delays.DeploymentsDelay)
	require.Empty(t, delays.PgHdfsDelay)
}

func TestParseDelayToMinutes(t *testing.T) {
	casos := []struct {
		nombre   string
		entrada  string
		esperado int
		conError bool
	}{
		{nombre: "cero", entrada: "0m", esperado: 0},
		{nombre: "cinco minutos", entrada: "5m", esperado: 5},
		{nombre: "diez minutos", entrada: "10m", esperado: 10},
		{nombre: "mas de una hora", entrada: "90m", esperado: 90},
		{nombre: "segundos a minutos", entrada: "120s", esperado: 2},
		// Una cadena vacía significa "sin delay" y no se considera un error.
		{nombre: "vacio", entrada: "", esperado: 0},
		{nombre: "texto no numerico", entrada: "cinco", conError: true},
		{nombre: "demasiado corto", entrada: "m", conError: true},
	}

	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			minutos, err := parseDelayToMinutes(c.entrada)
			if c.conError {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			require.Equal(t, c.esperado, minutos)
		})
	}
}

// TestPatronEscalonadoDelCluster reproduce el escalonado que usan los tenants de Banco
// Pichincha: las bases de datos primero, PgBouncer cinco minutos después y el resto del
// tenant diez minutos después de la hora base.
func TestPatronEscalonadoDelCluster(t *testing.T) {
	const horaBase = "12:30"

	pgHdfs, err := AddMinutes(horaBase, 0)
	require.NoError(t, err)
	pgbouncer, err := AddMinutes(horaBase, 5)
	require.NoError(t, err)
	resto, err := AddMinutes(horaBase, 10)
	require.NoError(t, err)

	require.Equal(t, "12:30", pgHdfs)
	require.Equal(t, "12:35", pgbouncer)
	require.Equal(t, "12:40", resto)
}

func TestAddMinutesCambioDeHoraYDeDia(t *testing.T) {
	casos := []struct {
		nombre   string
		base     string
		minutos  int
		esperado string
	}{
		{nombre: "cambio de hora", base: "12:55", minutos: 10, esperado: "13:05"},
		{nombre: "medianoche", base: "23:55", minutos: 10, esperado: "00:05"},
		{nombre: "delay negativo", base: "00:05", minutos: -10, esperado: "23:55"},
		{nombre: "sin delay", base: "12:00", minutos: 0, esperado: "12:00"},
	}

	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			resultado, err := AddMinutes(c.base, c.minutos)
			require.NoError(t, err)
			require.Equal(t, c.esperado, resultado)
		})
	}
}

// TestExtractDelaysFromSchedule cubre la lectura de los delays ya configurados. Es la pieza
// que permite reeditar el horario de un tenant sin perder su escalonado: sin ella, una
// actualización que no incluya delays los regenera con los valores por defecto.
func TestExtractDelaysFromSchedule(t *testing.T) {
	servicio := &ScheduleService{}

	escalonado := &ScheduleResponse{
		Tenant: "bdadevrie",
		Namespaces: map[string]NamespaceInfo{
			"datastores": {
				Namespace: "bdadevrie-datastores",
				Schedule: []SleepInfoSummary{
					{Role: "wake", Time: "12:30", Resources: []string{"PgCluster", "HDFSCluster"}},
					{Role: "wake", Time: "12:35", Resources: []string{"PgBouncer"}},
					{Role: "wake", Time: "12:40", Resources: []string{"Deployments"}},
					{Role: "sleep", Time: "02:30", Resources: []string{"PgCluster", "PgBouncer", "Deployments"}},
				},
			},
		},
	}

	delays := servicio.extractDelaysFromSchedule(escalonado, []string{"datastores"})
	require.NotNil(t, delays, "un tenant escalonado debe devolver sus delays")
	require.Equal(t, "5m", delays.PgbouncerDelay)
	require.Equal(t, "10m", delays.DeploymentsDelay)
}

func TestExtractDelaysFromScheduleSinEscalonado(t *testing.T) {
	servicio := &ScheduleService{}

	plano := &ScheduleResponse{
		Tenant: "bdadevdat",
		Namespaces: map[string]NamespaceInfo{
			"datastores": {
				Namespace: "bdadevdat-datastores",
				Schedule: []SleepInfoSummary{
					{Role: "wake", Time: "12:00", Resources: []string{"PgCluster", "HDFSCluster"}},
					{Role: "wake", Time: "12:00", Resources: []string{"PgBouncer"}},
					{Role: "wake", Time: "12:00", Resources: []string{"Deployments"}},
				},
			},
		},
	}

	require.Nil(t, servicio.extractDelaysFromSchedule(plano, []string{"datastores"}),
		"si todos los wake comparten hora no hay escalonado que preservar")
}

func TestExtractDelaysFromScheduleSinDatastores(t *testing.T) {
	servicio := &ScheduleService{}

	sinDatastores := &ScheduleResponse{
		Tenant: "bdadevrie",
		Namespaces: map[string]NamespaceInfo{
			"apps": {
				Namespace: "bdadevrie-apps",
				Schedule: []SleepInfoSummary{
					{Role: "wake", Time: "12:40", Resources: []string{"Deployments"}},
				},
			},
		},
	}

	require.Nil(t, servicio.extractDelaysFromSchedule(sinDatastores, []string{"apps"}),
		"el escalonado solo se deriva del namespace datastores")
}

func TestFormatMinutesToDelay(t *testing.T) {
	require.Equal(t, "0m", formatMinutesToDelay(0))
	require.Equal(t, "5m", formatMinutesToDelay(5))
	require.Equal(t, "10m", formatMinutesToDelay(10))
	// Un salto negativo se interpreta como cambio de día.
	require.Equal(t, "1435m", formatMinutesToDelay(-5))
}

func TestCalculateTimeDifferenceMinutes(t *testing.T) {
	require.Equal(t, 5, calculateTimeDifferenceMinutes("12:30", "12:35"))
	require.Equal(t, 10, calculateTimeDifferenceMinutes("12:30", "12:40"))
	require.Equal(t, 0, calculateTimeDifferenceMinutes("12:00", "12:00"))
}
