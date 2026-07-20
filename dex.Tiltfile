# dex.Tiltfile — an in-cluster Dex OIDC issuer for the kcp Tilt/kind dev
# environment, served through the same envoy gateway kcp uses.
#
# This file is fully self-contained (every manifest is built in Starlark, no
# sibling-file reads), so it is safe to load across repositories with
# load_dynamic() — e.g. from kcp's contrib/tilt Tiltfile as well as from this
# repo's Tiltfile.
#
# It assumes the shared kcp infra already exists (created by the caller):
#   - cert-manager + a self-signed Issuer named `selfsigned` in `default`
#   - an envoy Gateway `eg` in `envoy-gateway-system` doing TLS *passthrough*
#     on :8443 for `*.kcp.localhost`
#   - the gateway port-forwarded to localhost:8443 (kcp's port-forward.bash)
#
# deploy_dex() applies Dex and returns the `oidc` dict shape that
# deploy_kcp(oidc=...) expects, so the caller can hand it straight to kcp:
#
#   dex   = load_dynamic('dex.Tiltfile')['deploy_dex']
#   oidc  = dex()
#   deploy_kcp(..., hostnames=[..., 'dex.kcp.localhost'], oidc=oidc)
#
# Split-horizon: Dex is reached at https://dex.kcp.localhost:8443/dex from
# BOTH the browser (via /etc/hosts → 127.0.0.1 → the :8443 port-forward) and
# in-cluster pods (kcp shards + the dashboard BFF, via a hostAlias mapping the
# name to the gateway IP). The issuer URL is one identical string everywhere,
# which is what OIDC discovery/token validation require.

# bcrypt hash of "password" — the sample dev credential (admin / password),
# mirroring kcp's contrib/kcp-dex config.
_ADMIN_HASH = '$2a$10$2b2cU8CPhOTaGrs1HRQuAueS7JTT5ZHsHSzYiFPm1leZck7Mc8T4W'

# Groups: dex >= v2.45.0 supports a `groups` field on staticPasswords
# (storage.Password.Groups; passwordDB.Login sets Identity.Groups). We put the
# dev user in `system:kcp:admin`, which kcp's bootstrap policy binds to
# cluster-admin — so the OIDC identity gets kcp admin straight from the token,
# no extra RBAC needed. (This needs the pinned dex image below; older dex
# silently drops the field.)


def _dex_config(issuer_url, client_id, redirect_uris):
    return {
        'issuer': issuer_url,
        'web': {
            'https': '0.0.0.0:5556',
            'tlsCert': '/etc/dex/tls/tls.crt',
            'tlsKey': '/etc/dex/tls/tls.key',
        },
        'storage': {'type': 'memory'},
        'oauth2': {
            'skipApprovalScreen': True,
            'responseTypes': ['code'],
        },
        'staticClients': [{
            'id': client_id,
            'name': 'kcp dashboard',
            'public': True,  # public client → PKCE, no client secret
            'redirectURIs': redirect_uris,
        }],
        'enablePasswordDB': True,
        'staticPasswords': [{
            'email': 'admin',
            'hash': _ADMIN_HASH,
            'username': 'admin',
            'userID': '08a8684b-db88-4b73-90a9-3cd1661f5466',
            # kcp binds system:kcp:admin → cluster-admin in its bootstrap policy.
            'groups': ['system:kcp:admin', 'system:admin'],
        }],
    }


def deploy_dex(
        issuer_host = 'dex.kcp.localhost',
        namespace = 'default',
        gateway_name = 'eg',
        gateway_namespace = 'envoy-gateway-system',
        issuer_name = 'selfsigned',
        client_id = 'kcp-dashboard',
        redirect_uris = ['http://localhost:8080/auth/callback'],
        image = 'ghcr.io/dexidp/dex:v2.45.1',  # >= v2.45.0 for staticPasswords groups
        route_version = 'v1alpha3',
        cert_secret = 'dex-server-cert',
        resource_deps = [],
        labels = 'dex'):
    """Deploy an in-cluster Dex issuer and return the oidc dict for deploy_kcp().

    The returned dict includes caFileRef pointing at the cert-manager-issued
    server cert's `ca.crt`, so kcp trusts Dex's self-signed serving cert.
    """
    issuer_url = 'https://%s:8443/dex' % issuer_host

    cert = {
        'apiVersion': 'cert-manager.io/v1',
        'kind': 'Certificate',
        'metadata': {'name': cert_secret, 'namespace': namespace},
        'spec': {
            'secretName': cert_secret,
            'dnsNames': [issuer_host],
            'issuerRef': {
                'name': issuer_name,
                'kind': 'Issuer',
                'group': 'cert-manager.io',
            },
        },
    }

    config_map = {
        'apiVersion': 'v1',
        'kind': 'ConfigMap',
        'metadata': {'name': 'dex', 'namespace': namespace},
        'data': {
            'config.yaml': str(encode_yaml(
                _dex_config(issuer_url, client_id, redirect_uris))),
        },
    }

    deployment = {
        'apiVersion': 'apps/v1',
        'kind': 'Deployment',
        'metadata': {
            'name': 'dex',
            'namespace': namespace,
            'labels': {'app': 'dex'},
        },
        'spec': {
            'replicas': 1,
            'selector': {'matchLabels': {'app': 'dex'}},
            'template': {
                'metadata': {'labels': {'app': 'dex'}},
                'spec': {
                    'containers': [{
                        'name': 'dex',
                        'image': image,
                        'command': ['dex', 'serve', '/etc/dex/config/config.yaml'],
                        'ports': [{'containerPort': 5556, 'name': 'https'}],
                        'volumeMounts': [
                            {'name': 'config', 'mountPath': '/etc/dex/config', 'readOnly': True},
                            {'name': 'tls', 'mountPath': '/etc/dex/tls', 'readOnly': True},
                        ],
                        'readinessProbe': {
                            'tcpSocket': {'port': 5556},
                            'initialDelaySeconds': 2,
                            'periodSeconds': 5,
                        },
                    }],
                    'volumes': [
                        {'name': 'config', 'configMap': {'name': 'dex'}},
                        {'name': 'tls', 'secret': {'secretName': cert_secret}},
                    ],
                },
            },
        },
    }

    service = {
        'apiVersion': 'v1',
        'kind': 'Service',
        'metadata': {
            'name': 'dex',
            'namespace': namespace,
            'labels': {'app': 'dex'},
        },
        'spec': {
            'selector': {'app': 'dex'},
            'ports': [{'name': 'https', 'port': 5556, 'targetPort': 5556}],
        },
    }

    tls_route = {
        'apiVersion': 'gateway.networking.k8s.io/' + route_version,
        'kind': 'TLSRoute',
        'metadata': {'name': 'dex', 'namespace': namespace},
        'spec': {
            'parentRefs': [{'name': gateway_name, 'namespace': gateway_namespace}],
            'hostnames': [issuer_host],
            'rules': [{
                'backendRefs': [{'name': 'dex', 'port': 5556, 'namespace': namespace}],
            }],
        },
    }

    for obj in [cert, config_map, deployment, service, tls_route]:
        k8s_yaml(blob(str(encode_yaml(obj))))

    k8s_resource(
        'dex',
        # Group the non-workload objects (cert + route) under the dex resource.
        objects=['dex:tlsroute', cert_secret + ':certificate'],
        resource_deps=resource_deps,
        labels=labels,
    )

    print('Dex OIDC issuer → %s (login: admin / password)' % issuer_url)

    return {
        'issuerURL': issuer_url,
        'clientID': client_id,
        'usernameClaim': 'email',
        'groupsClaim': 'groups',
        'caFileRef': {'name': cert_secret, 'key': 'ca.crt'},
    }
