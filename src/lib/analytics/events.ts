import { z } from 'zod';

const empty = z.object({}).strict();
const errorCode = z.string().regex(/^[A-Z0-9_]{1,64}$/u);
const surface = z.enum(['home', 'workbench', 'designs', 'palettes', 'share', 'community', 'account', 'admin']);
const widthBucket = z.enum(['1-24', '25-50', '51-100', '101-150', '151-200']);
const colorBucket = z.enum(['1-24', '25-48', '49-72', '73-96', '97-144', '145+']);
const itemCountBucket = z.enum(['1', '2-5', '6-10', '11-25', '26-50']);

const eventSchemas = [
  z.object({ name: z.literal('page_viewed'), properties: z.object({ surface }).strict() }).strict(),
  z.object({ name: z.literal('upload_selected'), properties: z.object({
    mimeGroup: z.enum(['jpeg', 'png', 'webp', 'heic']),
    sizeBucket: z.enum(['0-1m', '1-5m', '5-10m', '10-20m']),
  }).strict() }).strict(),
  z.object({ name: z.literal('crop_completed'), properties: z.object({
    aspectBucket: z.enum(['square', 'portrait', 'landscape']),
  }).strict() }).strict(),
  z.object({ name: z.literal('generation_started'), properties: z.object({
    widthBucket, colorBucket, boardProfile: z.enum(['5mm-29', '2.6mm-50', '2.6mm-52']), dithering: z.boolean(),
  }).strict() }).strict(),
  z.object({ name: z.literal('generation_succeeded'), properties: z.object({ widthBucket, colorBucket }).strict() }).strict(),
  z.object({ name: z.literal('generation_failed'), properties: z.object({ errorCode }).strict() }).strict(),
  z.object({ name: z.literal('generation_cancelled'), properties: empty }).strict(),
  z.object({ name: z.literal('edit_applied'), properties: z.object({
    tool: z.enum(['brush', 'eraser', 'fill', 'pick', 'remap', 'transform']),
  }).strict() }).strict(),
  z.object({ name: z.literal('design_saved'), properties: z.object({
    source: z.enum(['local', 'cloud', 'community']),
  }).strict() }).strict(),
  z.object({ name: z.literal('design_exported'), properties: z.object({
    format: z.enum(['png', 'pdf', 'project']), source: z.enum(['community', 'other']),
  }).strict() }).strict(),
  z.object({ name: z.literal('export_failed'), properties: z.object({
    format: z.enum(['png', 'pdf', 'project']), errorCode,
  }).strict() }).strict(),
  z.object({ name: z.literal('share_created'), properties: empty }).strict(),
  z.object({ name: z.literal('share_revoked'), properties: empty }).strict(),
  z.object({ name: z.literal('share_viewed'), properties: empty }).strict(),
  z.object({ name: z.literal('auth_registered'), properties: empty }).strict(),
  z.object({ name: z.literal('email_verified'), properties: empty }).strict(),
  z.object({ name: z.literal('login_succeeded'), properties: empty }).strict(),
  z.object({ name: z.literal('logout_succeeded'), properties: empty }).strict(),
  z.object({ name: z.literal('community_list_viewed'), properties: z.object({
    sort: z.enum(['latest', 'featured', 'popular']),
  }).strict() }).strict(),
  z.object({ name: z.literal('community_detail_viewed'), properties: empty }).strict(),
  z.object({ name: z.literal('community_submission_created'), properties: empty }).strict(),
  z.object({ name: z.literal('community_submission_submitted'), properties: empty }).strict(),
  z.object({ name: z.literal('community_submission_withdrawn'), properties: empty }).strict(),
  z.object({ name: z.literal('community_reviewed'), properties: z.object({
    decision: z.enum(['published', 'rejected']),
  }).strict() }).strict(),
  z.object({ name: z.literal('community_published'), properties: empty }).strict(),
  z.object({ name: z.literal('community_reuse_succeeded'), properties: empty }).strict(),
  z.object({ name: z.literal('community_like_changed'), properties: z.object({
    action: z.enum(['added', 'removed']),
  }).strict() }).strict(),
  z.object({ name: z.literal('community_comment_created'), properties: z.object({
    moderationState: z.enum(['published', 'pending_review']),
  }).strict() }).strict(),
  z.object({ name: z.literal('community_comment_edited'), properties: z.object({
    moderationState: z.enum(['published', 'pending_review']),
  }).strict() }).strict(),
  z.object({ name: z.literal('community_report_created'), properties: z.object({
    targetType: z.enum(['work', 'comment']),
    reasonCategory: z.enum(['harassment', 'sexual', 'explicit_harm', 'spam', 'copyright', 'other']),
  }).strict() }).strict(),
  z.object({ name: z.literal('community_report_resolved'), properties: z.object({
    decision: z.enum(['resolved', 'dismissed']),
  }).strict() }).strict(),
  z.object({ name: z.literal('official_batch_started'), properties: z.object({ itemCountBucket }).strict() }).strict(),
  z.object({ name: z.literal('official_batch_item_succeeded'), properties: empty }).strict(),
  z.object({ name: z.literal('official_batch_item_failed'), properties: z.object({ errorCode }).strict() }).strict(),
  z.object({ name: z.literal('official_batch_completed'), properties: z.object({
    result: z.enum(['succeeded', 'partial', 'cancelled']), itemCountBucket,
  }).strict() }).strict(),
] as const;

export const analyticsClientEventSchema = z.discriminatedUnion('name', eventSchemas);
export type AnalyticsClientEvent = z.infer<typeof analyticsClientEventSchema>;
export type AnalyticsClientEventName = AnalyticsClientEvent['name'];
export type AnalyticsEventName = AnalyticsClientEventName | 'session_started';

const utmSchema = z.object({
  source: z.string().trim().min(1).max(100).optional(),
  medium: z.string().trim().min(1).max(100).optional(),
  campaign: z.string().trim().min(1).max(100).optional(),
  content: z.string().trim().min(1).max(100).optional(),
}).strict();

const envelopeFields = {
  eventId: z.uuid(),
  occurredAt: z.iso.datetime(),
  path: z.string().max(500).optional(),
  referrer: z.string().max(1000).optional(),
  utm: utmSchema.optional(),
};

export type AnalyticsEnvelope = AnalyticsClientEvent & {
  eventId: string;
  occurredAt: string;
  path?: string;
  referrer?: string;
  utm?: z.infer<typeof utmSchema>;
};

const envelopeSchemas = eventSchemas.map((schema) => schema.extend(envelopeFields));
export const analyticsEnvelopeSchema: z.ZodType<AnalyticsEnvelope> = z.union(
  envelopeSchemas as unknown as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]],
) as z.ZodType<AnalyticsEnvelope>;

export const analyticsBatchSchema = z.object({
  events: z.array(analyticsEnvelopeSchema).min(1).max(20),
}).strict();
