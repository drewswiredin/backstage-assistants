/**
 * Generative-UI form tool. The assistant calls the backend `render_form` tool
 * (a client-side tool — no server `execute`) with an RJSF form spec; this
 * renderer, registered via `makeAssistantToolUI`, shows the form inline in the
 * chat message stream. The user's submitted values become the tool result via
 * `addResult`, which resumes the turn (see the composer's `sendAutomaticallyWhen`
 * in useAssistantRuntime). Generic: the agent uses it any time it needs
 * structured / multi-field / multiple-choice input instead of asking in chat.
 *
 * Rendering goes through scaffolder's OWN RJSF `<Form>` (alpha) fed with the
 * field registry from `formFieldsApiRef.loadFormFields()` — the exact same set
 * the scaffolder wizard uses (built-in pickers AND any app-registered custom
 * fields), keyed by each field's name (`OwnerPicker`, `EntityPicker`, …). So any
 * `ui:field` the agent emits — including a scaffolder template's verbatim
 * schema/uiSchema — renders the real picker, dynamically, with no per-field code
 * here. Wrapped in `SecretsContextProvider` so the repo pickers render too.
 */
import { makeAssistantToolUI } from '@assistant-ui/react';
import { useEffect, useMemo, useState, type ComponentType } from 'react';
import { useApiHolder, type ApiHolder } from '@backstage/core-plugin-api';
import {
  Form,
  formFieldsApiRef,
  extractSchemaFromStep,
} from '@backstage/plugin-scaffolder-react/alpha';
import { SecretsContextProvider } from '@backstage/plugin-scaffolder-react';
import validator from '@rjsf/validator-ajv8';
import type { IChangeEvent } from '@rjsf/core';
import type { RJSFSchema, UiSchema } from '@rjsf/utils';
import { Box, Button, CircularProgress, Typography } from '@material-ui/core';
import { makeStyles } from '@material-ui/core/styles';

interface RenderFormArgs {
  jsonSchema?: RJSFSchema;
  uiSchema?: UiSchema;
  title?: string;
  submitLabel?: string;
}

const useStyles = makeStyles(theme => ({
  card: {
    margin: theme.spacing(0.5, 0),
    padding: theme.spacing(1.5, 2),
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: theme.shape.borderRadius,
    backgroundColor: theme.palette.background.paper,
    maxWidth: 560,
  },
  title: {
    fontWeight: 600,
    marginBottom: theme.spacing(1),
  },
  muted: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    color: theme.palette.text.secondary,
  },
  submitted: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    marginTop: theme.spacing(1),
    color: theme.palette.success?.main ?? '#0a7d52',
  },
  cancelled: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    color: theme.palette.text.secondary,
  },
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    marginTop: theme.spacing(1.5),
  },
}));

/** Tool result envelope — distinguishes an explicit submit from a dismissal. */
interface FormResult {
  submitted?: boolean;
  values?: unknown;
  cancelled?: boolean;
}

/** RJSF field registry: `ui:field` name → component. */
type FieldRegistry = Record<string, ComponentType<any>>;

/**
 * Scaffolder field extensions are stable for the app session, so load them once
 * and share across every rendered form. `loadFormFields()` returns the same set
 * scaffolder's wizard uses — built-in pickers plus any app-registered custom
 * fields — each keyed by its own `name`, which is what a template's `ui:field`
 * references. Degrades to an empty registry if scaffolder isn't installed (the
 * form still renders plain fields).
 */
let fieldsCache: Promise<FieldRegistry> | undefined;
function loadScaffolderFields(holder: ApiHolder): Promise<FieldRegistry> {
  if (!fieldsCache) {
    const api = holder.get(formFieldsApiRef);
    fieldsCache = api
      ? api
          .loadFormFields()
          .then(list =>
            Object.fromEntries(
              list.map(field => {
                // FormField is opaque to the type system but carries its name +
                // component at runtime (createFormField / OpaqueFormField).
                const f = field as unknown as {
                  name: string;
                  component: ComponentType<any>;
                };
                return [f.name, f.component];
              }),
            ),
          )
          .catch(() => ({}))
      : Promise.resolve({});
  }
  return fieldsCache;
}

/**
 * Registering component. Render once inside the assistant runtime tree; the
 * `render` fn below is what assistant-ui invokes inline for each `render_form`
 * tool-call part in the message stream.
 */
export const RenderFormTool = makeAssistantToolUI<RenderFormArgs, unknown>({
  toolName: 'render_form',
  render: function RenderForm({ args, result, addResult, status }) {
    const classes = useStyles();
    const holder = useApiHolder();
    const [fields, setFields] = useState<FieldRegistry | undefined>(undefined);

    useEffect(() => {
      let active = true;
      loadScaffolderFields(holder).then(f => {
        if (active) setFields(f);
      });
      return () => {
        active = false;
      };
    }, [holder]);

    const rawSchema = args?.jsonSchema;
    // Wait for BOTH the complete args AND the field registry — a `ui:field`
    // picker would error if its component isn't registered yet. A tool call with
    // no result carries its message's status, so `running` means the args are
    // still streaming in. Mounting then would hand each picker a half-written
    // spec, and pickers read `ui:options` once, on mount: EntityPicker fetches
    // with whatever `catalogFilter` it first sees, so a picker mounted before
    // its filter streamed in lists every entity until a reload.
    const argsComplete = status?.type !== 'running';
    const ready =
      argsComplete &&
      !!rawSchema &&
      typeof rawSchema === 'object' &&
      Object.keys(rawSchema).length > 0;

    // Scaffolder TEMPLATES embed `ui:*` keys (ui:field, ui:options, ui:autofocus)
    // directly inside the JSON schema properties, and agents commonly lift a
    // template's parameter block verbatim. RJSF only honours `ui:*` from the
    // uiSchema, so hoist them out exactly as scaffolder's own wizard does
    // (extractSchemaFromStep) — otherwise a picker's `ui:options` (e.g.
    // OwnerPicker's catalog filter) is silently dropped and it renders as a plain
    // input with no choices. Safe when the schema is already clean (empty uiSchema).
    const { schema, hoistedUiSchema } = useMemo(() => {
      if (!ready) {
        return { schema: rawSchema, hoistedUiSchema: {} as UiSchema };
      }
      const extracted = extractSchemaFromStep(rawSchema as any);
      return {
        schema: extracted.schema as RJSFSchema,
        hoistedUiSchema: extracted.uiSchema,
      };
    }, [rawSchema, ready]);

    // `schema === undefined` is implied by `!ready` — stated so the narrowing is
    // visible to the type checker at the <Form schema=…> below.
    if (!ready || fields === undefined || schema === undefined) {
      return (
        <Box className={classes.card}>
          <span className={classes.muted}>
            <CircularProgress size={14} thickness={5} />
            <Typography variant="body2" component="span">
              Preparing form…
            </Typography>
          </span>
        </Box>
      );
    }

    const r = result as FormResult | undefined;
    // A result only counts as "submitted" if it carries our explicit envelope.
    // Anything else (the Cancel button, or assistant-ui auto-resolving the
    // pending tool-call when the user ignores the form and sends a new message)
    // is a dismissal — shown as cancelled, never as submitted.
    const submitted = r?.submitted === true;
    const dismissed = r !== undefined && !submitted;

    const title = args?.title && (
      <Typography variant="subtitle1" className={classes.title}>
        {args.title}
      </Typography>
    );

    if (dismissed) {
      return (
        <Box className={classes.card}>
          {title}
          <Typography variant="body2" className={classes.cancelled}>
            ✗ Form dismissed
          </Typography>
        </Box>
      );
    }

    // A separately-supplied args.uiSchema overrides the hoisted keys per entry.
    const uiSchema: UiSchema = {
      ...hoistedUiSchema,
      ...(args?.uiSchema ?? {}),
    };

    return (
      <Box className={classes.card}>
        {title}
        {/* SecretsContextProvider lets scaffolder's repo pickers (RepoUrlPicker,
            RepoBranchPicker, RepoOwnerPicker) render — they stash SCM tokens in
            this context. Harmless for forms that don't use them. */}
        <SecretsContextProvider>
          <Form
            schema={schema}
            uiSchema={uiSchema}
            fields={fields}
            validator={validator}
            formData={submitted ? (r?.values as object) : undefined}
            disabled={submitted}
            onSubmit={(e: IChangeEvent) =>
              addResult({ submitted: true, values: e.formData })
            }
          >
            {submitted ? (
              // Submitted: read-only record, no buttons.
              <></>
            ) : (
              // Active: custom footer with Submit + an always-present Cancel.
              <div className={classes.actions}>
                <Button
                  type="submit"
                  variant="contained"
                  color="primary"
                  size="small"
                >
                  {args?.submitLabel ?? 'Submit'}
                </Button>
                <Button
                  type="button"
                  variant="text"
                  size="small"
                  onClick={() =>
                    addResult({ submitted: false, cancelled: true })
                  }
                >
                  Cancel
                </Button>
              </div>
            )}
          </Form>
        </SecretsContextProvider>
        {submitted && (
          <Typography variant="caption" className={classes.submitted}>
            ✓ Submitted
          </Typography>
        )}
      </Box>
    );
  },
});
