import { useState } from 'react';
import { ProxiedSignInPage } from '@backstage/core-components';
import type { SignInPageProps } from '@backstage/plugin-app-react';
import Button from '@material-ui/core/Button';
import Card from '@material-ui/core/Card';
import CardContent from '@material-ui/core/CardContent';
import Typography from '@material-ui/core/Typography';

type DevUser = { ref: string; label: string; hint: string };

// Mirrors DEV_USERS in packages/backend/src/devUserPickProvider.ts.
const USERS: DevUser[] = [
  {
    ref: 'user:development/guest-user',
    label: 'guest-user',
    hint: 'no groups — denied: cannot use the assistants plugin',
  },
  {
    ref: 'user:development/guest-assistants-user',
    label: 'guest-assistants-user',
    hint: 'assistants-users — can use; sees mapped assistants; no gear',
  },
  {
    ref: 'user:development/guest-assistants-admin',
    label: 'guest-assistants-admin',
    hint: 'assistants-users + assistants-admins — can use AND manage (gear)',
  },
];

/**
 * Dev-only sign-in picker. Picking a user mounts a {@link ProxiedSignInPage}
 * bound to the `dev-userpick` backend provider, sending the chosen user entity
 * ref in the `x-dev-user-ref` header. The backend mints a real Backstage token
 * (with that user's group ownership) and ProxiedSignInPage signs you in.
 *
 * Switch users via the user-settings menu → Sign Out, then pick another.
 */
export function SignInPicker(props: SignInPageProps) {
  const [chosen, setChosen] = useState<DevUser | undefined>();

  if (chosen) {
    return (
      <ProxiedSignInPage
        {...props}
        provider="dev-userpick"
        headers={{ 'x-dev-user-ref': chosen.ref }}
      />
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        padding: 24,
      }}
    >
      <Card style={{ maxWidth: 560, width: '100%' }}>
        <CardContent>
          <Typography variant="h5" gutterBottom>
            Sign in (development)
          </Typography>
          <Typography variant="body2" color="textSecondary" gutterBottom>
            Choose a user. Switch later via Settings → Sign Out.
          </Typography>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              marginTop: 16,
            }}
          >
            {USERS.map(u => (
              <Button
                key={u.ref}
                variant="outlined"
                color="primary"
                fullWidth
                onClick={() => setChosen(u)}
                style={{
                  textTransform: 'none',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  padding: 12,
                }}
              >
                <span style={{ fontWeight: 600 }}>{u.label}</span>
                <span style={{ fontSize: 12, opacity: 0.7 }}>{u.hint}</span>
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
