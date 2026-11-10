// The web app's real engine client (pure, no `server-only`) against the running engine.
import axios from 'axios';
import {
  createAuthUser,
  deleteAuthUser,
  setEligibility,
} from '../support/auth-users';
import { createDraftProfile } from '../support/profiles';
// The one cross-project import: the web app is not a library, and this is the real client code under test.
// eslint-disable-next-line @nx/enforce-module-boundaries
import { createEngineClient } from '../../../web/src/lib/engine/client';

describe('web engine client against the running engine', () => {
  let userId: string;
  let profileId: string;
  let accessToken: string;

  const engine = () =>
    createEngineClient({
      url: axios.defaults.baseURL,
      apiKey: process.env.ENGINE_API_KEY,
      accessToken: async () => accessToken,
      log: () => undefined,
    });

  beforeAll(async () => {
    ({ id: userId, accessToken } = await createAuthUser('web-client'));
    await setEligibility(userId);
    profileId = await createDraftProfile(userId);
  });

  afterAll(async () => {
    if (userId) await deleteAuthUser(userId);
  });

  it("publishes the signed-in user's draft through the running engine", async () => {
    expect(await engine().publishProfile(profileId)).toEqual({
      kind: 'ok',
      data: expect.objectContaining({ id: profileId, state: 'published' }),
    });
  });

  it('a second publish is conflict/already-published', async () => {
    expect(await engine().publishProfile(profileId)).toEqual({
      kind: 'conflict',
      reason: 'already-published',
    });
  });
});
