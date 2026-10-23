import { api } from '../services/api';
import type { ApiUser } from '../services/api';
import type { UserProfile } from '../types';

export function useProfile(user: ApiUser | null, refresh: () => Promise<ApiUser>) {
  const profile: UserProfile | null = user ? {
    username: user.username, display_name: user.profile.display_name || user.username,
    email: user.email, avatar_url: user.profile.avatar_url || null, preferred_language: 'pl',
  } : null;
  return {
    profile,
    saveProfile: async (next: Pick<UserProfile, 'username' | 'display_name' | 'avatar_url'>) => {
      try {
        if (next.username !== user?.username) await api.account.update({ username: next.username });
        await api.account.updateProfile({ display_name: next.display_name, avatar_url: next.avatar_url ?? '', preferred_language: 'pl' });
      } finally { await refresh(); }
    },
  };
}
