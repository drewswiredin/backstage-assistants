/*
 * Dev-only multi-user sign-in provider (`dev-userpick`).
 *
 * The in-app sign-in picker (packages/app/src/modules/signIn) sends the chosen
 * user entity ref in an `x-dev-user-ref` header to
 * `/api/auth/dev-userpick/refresh`. We mint a REAL Backstage user token for that
 * user, carrying the group ownership refs the AssistantsPermissionPolicy and the
 * per-assistant access policy read from `ownershipEntityRefs`.
 *
 * Modelled on @backstage/plugin-auth-backend-module-guest-provider: same
 * createProxyAuthenticator + createProxyAuthProviderFactory shape, but the user
 * is chosen per request (from the header) instead of from static config, and
 * ownership is issued directly via `ctx.issueToken` — so no catalog entities are
 * required. Development only: disabled when NODE_ENV !== 'development'.
 */
import {
  coreServices,
  createBackendModule,
} from '@backstage/backend-plugin-api';
import {
  authProvidersExtensionPoint,
  createProxyAuthenticator,
  createProxyAuthProviderFactory,
} from '@backstage/plugin-auth-node';
import { InputError, NotAllowedError } from '@backstage/errors';

/**
 * The selectable dev users and the ownership entity refs each is signed in with.
 * Ownership drives the permission policy (assistant.use / assistant.manage gated
 * on the group refs) and the per-assistant access policy. The `development`
 * namespace matches the group refs the policy checks.
 */
export const DEV_USERS: Record<string, string[]> = {
  'user:development/guest-user': ['user:development/guest-user'],
  'user:development/guest-assistants-user': [
    'user:development/guest-assistants-user',
    'group:development/assistants-users',
  ],
  'user:development/guest-assistants-admin': [
    'user:development/guest-assistants-admin',
    'group:development/assistants-users',
    'group:development/assistants-admins',
  ],
};

const HEADER = 'x-dev-user-ref';

const devUserPickAuthenticator = createProxyAuthenticator({
  defaultProfileTransform: async (result: { userRef: string }) => ({
    profile: { displayName: result.userRef.split('/').pop() },
  }),
  // TContext is a boolean "disabled" flag, mirroring the guest authenticator.
  initialize() {
    return process.env.NODE_ENV !== 'development';
  },
  async authenticate({ req }, disabled: boolean) {
    if (disabled) {
      throw new NotAllowedError(
        'The dev-userpick provider is only available in development',
      );
    }
    const raw = req.headers[HEADER];
    const userRef = Array.isArray(raw) ? raw[0] : raw;
    if (!userRef || !DEV_USERS[userRef]) {
      throw new InputError(
        `'${HEADER}' header must name one of the configured dev users`,
      );
    }
    return { result: { userRef } };
  },
});

export default createBackendModule({
  pluginId: 'auth',
  moduleId: 'dev-userpick-provider',
  register(reg) {
    reg.registerInit({
      deps: {
        providers: authProvidersExtensionPoint,
        logger: coreServices.logger,
      },
      async init({ providers, logger }) {
        providers.registerProvider({
          providerId: 'dev-userpick',
          factory: createProxyAuthProviderFactory({
            authenticator: devUserPickAuthenticator,
            async signInResolver(
              { result }: { result: { userRef: string } },
              ctx,
            ) {
              const ent = DEV_USERS[result.userRef] ?? [result.userRef];
              return ctx.issueToken({
                claims: { sub: result.userRef, ent },
              });
            },
          }),
        });
        logger.info('Registered dev-userpick auth provider (development only)');
      },
    });
  },
});
