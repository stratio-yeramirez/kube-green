package resource

import (
	"context"
	"errors"
	"fmt"
	"strings"

	kubegreenv1alpha1 "github.com/kube-green/kube-green/api/v1alpha1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"

	"github.com/go-logr/logr"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

var ErrInvalidClient = errors.New("invalid client")

type Resource interface {
	HasResource() bool
	Sleep(ctx context.Context) error
	WakeUp(ctx context.Context) error
	GetOriginalInfoToSave() ([]byte, error)
	GetSleepGenerationsToSave() ([]byte, error)
}

type ResourceClient struct {
	Client client.Client
	// Reader lee directamente de la API, sin pasar por la caché del informer. Se usa para
	// releer un recurso justo después de modificarlo, cuando la caché todavía devuelve la
	// versión anterior. Si es nil se recurre a Client.
	Reader           client.Reader
	SleepInfo        *kubegreenv1alpha1.SleepInfo
	Log              logr.Logger
	FieldManagerName string
}

// ReaderOrClient devuelve el lector directo a la API si está configurado y, si no, el
// cliente con caché.
func (r ResourceClient) ReaderOrClient() client.Reader {
	if r.Reader != nil {
		return r.Reader
	}
	return r.Client
}

func (r ResourceClient) Patch(ctx context.Context, oldObj, newObj client.Object) error {
	if err := r.IsClientValid(); err != nil {
		return err
	}
	if err := r.Client.Patch(ctx, newObj, client.MergeFrom(oldObj)); err != nil {
		if client.IgnoreNotFound(err) == nil {
			return nil
		}
		return err
	}
	return nil
}

// Server Side Apply patch. Reference: https://kubernetes.io/docs/reference/using-api/server-side-apply/
func (r ResourceClient) SSAPatch(ctx context.Context, newObj *unstructured.Unstructured) error {
	if err := r.IsClientValid(); err != nil {
		return err
	}
	newObj.SetManagedFields(nil)
	newObj.SetResourceVersion("")
	if err := r.Client.Apply(ctx,
		client.ApplyConfigurationFromUnstructured(newObj),
		client.FieldOwner(r.FieldManagerName),
		client.ForceOwnership,
	); err != nil {
		if client.IgnoreNotFound(err) == nil {
			return nil
		}
		return err
	}
	return nil
}

var errClientEmpty = "client is empty"
var errSleepInfoEmpty = "sleepInfo is nil"

func (r ResourceClient) IsClientValid() error {
	if r.Client != nil && r.SleepInfo != nil {
		return nil
	}

	errStrings := []string{}
	if r.Client == nil {
		errStrings = append(errStrings, errClientEmpty)
	}
	if r.SleepInfo == nil {
		errStrings = append(errStrings, errSleepInfoEmpty)
	}
	return fmt.Errorf("%w: %s", ErrInvalidClient, strings.Join(errStrings, " and "))
}
