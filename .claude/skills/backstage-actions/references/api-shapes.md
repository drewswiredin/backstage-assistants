# Actions alpha type shapes (source of truth)

These are the verbatim `@alpha` declarations from `@backstage/backend-plugin-api/dist/alpha.d.ts`. **Always re-verify against the version installed in `node_modules`** — these are a snapshot and the surface drifts. Fetch a specific version with:

```
curl -sL https://unpkg.com/@backstage/backend-plugin-api@<version>/dist/alpha.d.ts
```

The Actions service was absent from `1.3.0/alpha` (which only had `instanceMetadataServiceRef`). It landed by `1.4.3`.

## `1.4.3` (clean baseline)

```ts
import { AnyZodObject, z } from 'zod';
import { LoggerService, BackstageCredentials } from '@backstage/backend-plugin-api';
import { JsonObject, JsonValue } from '@backstage/types';
import { JSONSchema7 } from 'json-schema';

// --- REGISTER side ---

type ActionsRegistryActionContext<TInputSchema extends AnyZodObject> = {
  input: z.infer<TInputSchema>;
  logger: LoggerService;
  credentials: BackstageCredentials;
};

type ActionsRegistryActionOptions<
  TInputSchema extends AnyZodObject,
  TOutputSchema extends AnyZodObject,
> = {
  name: string;
  title: string;
  description: string;
  schema: {
    input: (zod: typeof z) => TInputSchema;   // FUNCTION returning a zod object
    output: (zod: typeof z) => TOutputSchema;
  };
  attributes?: {
    destructive?: boolean;
    idempotent?: boolean;
    readOnly?: boolean;
  };
  action: (
    context: ActionsRegistryActionContext<TInputSchema>,
  ) => Promise<
    z.infer<TOutputSchema> extends void ? void : { output: z.infer<TOutputSchema> }
  >;
};

interface ActionsRegistryService {
  register<TInputSchema extends AnyZodObject, TOutputSchema extends AnyZodObject>(
    options: ActionsRegistryActionOptions<TInputSchema, TOutputSchema>,
  ): void;
}

// --- LIST + INVOKE side ---

type ActionsServiceAction = {
  id: string;        // "pluginId:name"
  name: string;
  title: string;
  description: string;
  schema: {
    input: JSONSchema7;   // NOTE: JSON Schema here, not zod
    output: JSONSchema7;
  };
  attributes: {
    readOnly: boolean;
    destructive: boolean;
    idempotent: boolean;
  };
};

interface ActionsService {
  list: (opts: { credentials: BackstageCredentials }) => Promise<{
    actions: ActionsServiceAction[];
  }>;
  invoke(opts: {
    id: string;
    input?: JsonObject;
    credentials: BackstageCredentials;
  }): Promise<{ output: JsonValue }>;
}

declare const actionsServiceRef: ServiceRef<ActionsService, 'plugin', 'singleton'>;
declare const actionsRegistryServiceRef: ServiceRef<ActionsRegistryService, 'plugin', 'singleton'>;
```

## Drift `1.4.3` → `1.9.1`

Confirmed differences in the actions surface (re-check whatever you actually install):

- **zod import** changed from `from 'zod'` to `from 'zod/v3'`. The schema functions still receive `z` and the `(zod: typeof z) => ...` shape is unchanged, but the underlying zod major matters if you import zod yourself elsewhere.
- **`ActionsRegistryActionExample<I,O>`** added; `ActionsRegistryActionOptions` gains optional `examples?: Array<...>` and `visibilityPermission?: BasicPermission` (from `@backstage/plugin-permission-common`). A denied `visibilityPermission` removes the action from `list` results and makes `invoke` return `404`.
- **`ActionsServiceAction`** gains `pluginId: string` and optional `examples?: Array<{ title; description?; input: JsonObject; output?: JsonObject }>`.
- The `ActionsRegistryService` / `ActionsService` interface methods themselves (`register`, `list`, `invoke`) are unchanged in signature across these versions.

## Handler return-shape gotcha

The handler must return `{ output: <value matching the output zod schema> }`. The official `actions-registry.md` doc has an example that returns `output: deletedEntities` (a bare array) against an object output schema — that is a **doc bug**. Follow the typed `.d.ts`: the value under `output` must match `z.infer<TOutputSchema>`.

## ID vs name

- Register with a bare `name` (`search-catalog`).
- The registry assigns `id = "<pluginId>:<name>"` (e.g. `ai-agents:search-catalog`; the test mock uses prefix `test:`).
- `list` returns both. Filter an agent allowlist on `name`; pass `id` to `invoke`.
