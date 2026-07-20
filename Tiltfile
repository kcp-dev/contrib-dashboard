# contrib-dashboard — standalone Tilt dev environment.
#
# Stands up a static kcp using the kcp tilt library (deploy_kcp from
# kcp_static.Tiltfile) and deploys the dashboard on top, so `tilt up` here gives you
# kcp + the dashboard in one shot, in no-oidc mode.
#
# Requires a local kcp checkout for the tilt library + infra manifests. Point
# KCP_DIR at it (default: ../kcp, i.e. a sibling clone under .../kcp-dev/):
#
#   tilt up                          # uses ../kcp
#   KCP_DIR=/path/to/kcp tilt up
#
# Disable the (optional) theseus second shard with KCP_SINGLE_SHARD=true.

load('ext://helm_remote', 'helm_remote')
load('ext://namespace', 'namespace_create')
load('ext://cert_manager', 'deploy_cert_manager')

KCP_DIR = os.getenv('KCP_DIR', '../kcp')
TILT = KCP_DIR + '/contrib/tilt'
if not os.path.exists(TILT + '/kcp_static.Tiltfile'):
    fail('kcp tilt library not found at %s — set KCP_DIR to your kcp checkout' % TILT)

# --- infrastructure (mirrors kcp's contrib/tilt/Tiltfile.static) ---------------
# cert-manager (+ self-signed issuer), envoy gateway, etcd and the kcp-operator.
# The caller owns infra; deploy_kcp() below only adds the kcp resources on top.
k8s_yaml(TILT + '/kernel-limits-job.yaml')

deploy_cert_manager(version='v1.19.2')
k8s_yaml(TILT + '/issuer.yaml')

namespace_create('envoy-gateway-system')
helm_remote(
    'gateway-helm',
    repo_url='oci://registry-1.docker.io/envoyproxy',
    repo_name='gateway-helm',
    release_name='envoy',
    namespace='envoy-gateway-system',
    version='v1.7.0',
)
k8s_yaml(TILT + '/gateway.yaml')
# port-forward.bash is self-contained (kubectl only) and safe to run by path.
local_resource('ingress', serve_cmd=TILT + '/port-forward.bash', allow_parallel=True)

k8s_yaml(kustomize(TILT + '/etcd'))
k8s_yaml(kustomize(TILT + '/kcp-operator'))

# --- kcp (static) via the kcp tilt library -------------------------------------
# kcp_static.Tiltfile builds every manifest in Starlark (no sibling-file reads),
# so it is safe to load across repositories. load_dynamic() allows the computed
# path (the `load` statement requires a string literal).
kcp_lib = load_dynamic(TILT + '/kcp_static.Tiltfile')
deploy_kcp = kcp_lib['deploy_kcp']

extra_shards = [] if os.getenv('KCP_SINGLE_SHARD', '').lower() in ('true', '1', 'yes', 'on') else ['theseus']
deploy_kcp(base_domain='kcp.localhost', extra_shards=extra_shards)

# --- the dashboard ----------------------------------------------------------------
# Runs in no-oidc mode: mounts the admin kubeconfig the operator publishes
# (secret kcp-frontproxy-kubeconfig) and proxies to the front-proxy Service.
docker_build(
    ref='kcp-dashboard',
    context='.',
    dockerfile='Dockerfile',
    ignore=['node_modules', 'web/dist', 'server/dist', '**/*.log'],
)
k8s_yaml('deploy/deployment.yaml')
k8s_resource(
    'kcp-dashboard',
    port_forwards=['8080:8080'],
    # Wait for the admin kubeconfig secret to be extracted so the mount exists.
    resource_deps=['kcp-admin extract'],
    labels='dashboard',
)

print('kcp dashboard → http://localhost:8080 (no-oidc)')
