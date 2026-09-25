package resource

import (
	"context"
	"testing"

	kubegreenv1alpha1 "github.com/kube-green/kube-green/api/v1alpha1"

	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"
)

// El controlador relee la generación de cada recurso justo después de dormirlo, para poder
// detectar más tarde si alguien lo modificó mientras dormía. Esa lectura tiene que ir contra
// la API y no contra la caché del informer: la caché devuelve todavía la versión anterior al
// patch, y guardar ese número hace que al despertar el recurso parezca modificado por un
// tercero y se omita su encendido. Le pasó a un tenant entero, que amaneció con los PgBouncer
// y los deployments a cero.
//
// Estos tests fijan que ResourceClient prefiere el lector directo cuando lo tiene.

func deployment(nombre string, generacion int64) *appsv1.Deployment {
	return &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:       nombre,
			Namespace:  "un-namespace",
			Generation: generacion,
		},
	}
}

func esquema(t *testing.T) *runtime.Scheme {
	t.Helper()
	s := runtime.NewScheme()
	require.NoError(t, appsv1.AddToScheme(s))
	require.NoError(t, kubegreenv1alpha1.AddToScheme(s))
	return s
}

func TestReaderOrClientPrefiereElLectorDirecto(t *testing.T) {
	s := esquema(t)

	// La caché se ha quedado con la generación previa al patch; la API ya tiene la nueva.
	cache := fake.NewClientBuilder().WithScheme(s).WithObjects(deployment("un-deployment", 7)).Build()
	api := fake.NewClientBuilder().WithScheme(s).WithObjects(deployment("un-deployment", 8)).Build()

	res := ResourceClient{Client: cache, Reader: api}

	leido := &appsv1.Deployment{}
	require.NoError(t, res.ReaderOrClient().Get(context.Background(),
		types.NamespacedName{Name: "un-deployment", Namespace: "un-namespace"}, leido))

	require.Equal(t, int64(8), leido.GetGeneration(),
		"la generación debe leerse de la API, no de la caché del informer")
}

func TestReaderOrClientCaeAlClienteSiNoHayLector(t *testing.T) {
	s := esquema(t)
	cache := fake.NewClientBuilder().WithScheme(s).WithObjects(deployment("un-deployment", 7)).Build()

	res := ResourceClient{Client: cache}

	require.NotNil(t, res.ReaderOrClient(), "sin lector directo debe seguir funcionando con el cliente")

	leido := &appsv1.Deployment{}
	require.NoError(t, res.ReaderOrClient().Get(context.Background(),
		types.NamespacedName{Name: "un-deployment", Namespace: "un-namespace"}, leido))
	require.Equal(t, int64(7), leido.GetGeneration())
}

func TestReaderOrClientDevuelveElLectorConfigurado(t *testing.T) {
	s := esquema(t)
	cache := fake.NewClientBuilder().WithScheme(s).Build()
	api := fake.NewClientBuilder().WithScheme(s).Build()

	var reader client.Reader = api
	res := ResourceClient{Client: cache, Reader: reader}

	require.Same(t, reader, res.ReaderOrClient())
}
