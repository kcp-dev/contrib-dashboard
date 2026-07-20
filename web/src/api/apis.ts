// apis.kcp.io resource operations: APIExport, APIBinding,
// APIExportEndpointSlice, APIResourceSchema.

import { api, kcpUrl } from "./client";
import type { List } from "../types/kcp";
import {
  APIS_GROUP,
  APIS_V2,
  APIS_V1,
  type APIExport,
  type APIBinding,
  type APIExportEndpointSlice,
  type APIResourceSchema,
} from "../types/apis";

const v2 = (res: string) => `apis/${APIS_GROUP}/${APIS_V2}/${res}`;
const v1 = (res: string) => `apis/${APIS_GROUP}/${APIS_V1}/${res}`;

// ---- APIExport ----

export function listAPIExports(cluster: string): Promise<List<APIExport>> {
  return api.get<List<APIExport>>(kcpUrl(cluster, v2("apiexports")));
}

export function getAPIExport(cluster: string, name: string): Promise<APIExport> {
  return api.get<APIExport>(kcpUrl(cluster, v2(`apiexports/${name}`)));
}

// ---- APIExportEndpointSlice (v1alpha1) ----

export function listEndpointSlices(
  cluster: string,
): Promise<List<APIExportEndpointSlice>> {
  return api.get<List<APIExportEndpointSlice>>(
    kcpUrl(cluster, v1("apiexportendpointslices")),
  );
}

// ---- APIResourceSchema (v1alpha1) ----

export function getAPIResourceSchema(
  cluster: string,
  name: string,
): Promise<APIResourceSchema> {
  return api.get<APIResourceSchema>(
    kcpUrl(cluster, v1(`apiresourceschemas/${name}`)),
  );
}

// ---- APIBinding ----

export function listAPIBindings(cluster: string): Promise<List<APIBinding>> {
  return api.get<List<APIBinding>>(kcpUrl(cluster, v2("apibindings")));
}

export function deleteAPIBinding(
  cluster: string,
  name: string,
): Promise<unknown> {
  return api.delete(kcpUrl(cluster, v2(`apibindings/${name}`)));
}

// Create an APIBinding referencing an export at exportPath/exportName. Claims
// are passed through verbatim (already shaped as AcceptablePermissionClaim).
export function createAPIBinding(
  cluster: string,
  name: string,
  exportRef: { path?: string; name: string },
  claims: APIBinding["spec"]["permissionClaims"],
): Promise<APIBinding> {
  const body: APIBinding = {
    apiVersion: `${APIS_GROUP}/${APIS_V2}`,
    kind: "APIBinding",
    metadata: { name },
    spec: {
      reference: { export: exportRef },
      ...(claims && claims.length ? { permissionClaims: claims } : {}),
    },
  };
  return api.post<APIBinding>(kcpUrl(cluster, v2("apibindings")), body);
}
