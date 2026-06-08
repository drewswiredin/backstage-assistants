/**
 * Generative-UI form tool. The assistant calls the backend `render_form` tool
 * (a client-side tool — no server `execute`) with an RJSF form spec; this
 * renderer, registered via `makeAssistantToolUI`, shows the form inline in the
 * chat message stream. The user's submitted values become the tool result via
 * `addResult`, which resumes the turn (see the composer's `sendAutomaticallyWhen`
 * in useAssistantRuntime). Generic: the agent uses it any time it needs
 * structured / multi-field / multiple-choice input instead of asking in chat.
 *
 * v1 renders plain RJSF (MUI v4 theme, matching the app). Backstage scaffolder
 * field extensions (owner/entity pickers) can be registered here later.
 */
import { makeAssistantToolUI } from '@assistant-ui/react';
import Form from '@rjsf/material-ui';
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

/**
 * Registering component. Render once inside the assistant runtime tree; the
 * `render` fn below is what assistant-ui invokes inline for each `render_form`
 * tool-call part in the message stream.
 */
export const RenderFormTool = makeAssistantToolUI<RenderFormArgs, unknown>({
  toolName: 'render_form',
  render: function RenderForm({ args, result, addResult }) {
    const classes = useStyles();
    const schema = args?.jsonSchema;
    // Args stream in token by token — wait for a complete schema before RJSF
    // tries to render (a partial schema would throw).
    const ready =
      !!schema && typeof schema === 'object' && Object.keys(schema).length > 0;
    if (!ready) {
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

    const uiSchema: UiSchema = args?.uiSchema ?? {};

    return (
      <Box className={classes.card}>
        {title}
        <Form
          schema={schema}
          uiSchema={uiSchema}
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
              <Button type="submit" variant="contained" color="primary" size="small">
                {args?.submitLabel ?? 'Submit'}
              </Button>
              <Button
                type="button"
                variant="text"
                size="small"
                onClick={() => addResult({ submitted: false, cancelled: true })}
              >
                Cancel
              </Button>
            </div>
          )}
        </Form>
        {submitted && (
          <Typography variant="caption" className={classes.submitted}>
            ✓ Submitted
          </Typography>
        )}
      </Box>
    );
  },
});
