import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { Paginated } from '@/types/property';

/** Platforms supported by the backend (config/meta.php SOCIAL_PLATFORMS). */
export type SocialPlatform = 'facebook' | 'instagram' | 'both';
/** Post lifecycle (config/meta.php SOCIAL_STATUSES). */
export type SocialStatus = 'draft' | 'scheduled' | 'published' | 'failed';

/** A row from `social_posts` joined with its property (api/social_posts.php). */
export interface SocialPost {
  id: number;
  property_id: number | null;
  platform: SocialPlatform;
  caption: string;
  image_path: string | null;
  scheduled_at: string;
  published_at: string | null;
  status: SocialStatus;
  facebook_post_id: string | null;
  instagram_media_id: string | null;
  error_message: string | null;
  created_at: string | null;
  updated_at: string | null;
  property_address: string | null;
  property_city: string | null;
}

/** Public Meta settings payload (api/social_settings.php → publicSocialSettings). */
export interface SocialSettings {
  meta_app_id: string | null;
  facebook_page_id: string | null;
  facebook_page_token: string | null;
  instagram_account_id: string | null;
  token_expires_at: string | null;
  is_connected: boolean;
  has_instagram: boolean;
  updated_at: string | null;
}

export interface CreatePostInput {
  caption: string;
  platform: SocialPlatform;
  scheduled_at: string;
  status: SocialStatus;
  property_id?: number | null;
}

export function useSocialPosts() {
  return useQuery({
    queryKey: ['social_posts'],
    queryFn: ({ signal }) =>
      api.get<Paginated<SocialPost>>('social_posts.php', { params: { limit: 300 }, signal }),
  });
}

export function useSocialSettings() {
  return useQuery({
    queryKey: ['social_settings'],
    queryFn: ({ signal }) => api.get<SocialSettings>('social_settings.php', { signal }),
  });
}

export function useCreatePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePostInput) => api.post<SocialPost>('social_posts.php', input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['social_posts'] });
    },
  });
}

export function usePublishPost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      api.patch<SocialPost>('social_posts.php', undefined, { params: { id, action: 'publish' } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['social_posts'] });
    },
  });
}
