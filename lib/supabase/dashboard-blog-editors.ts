import 'server-only'

import { getSupabaseAdmin } from './admin'

export interface DashboardBlogEditorRecord {
  id: string
  email: string
  password_hash: string
  session_version: number
  last_login_at: string | null
  created_at: string
  updated_at: string
}

export type PublicDashboardBlogEditor = Omit<DashboardBlogEditorRecord, 'password_hash' | 'session_version'>

const EDITOR_COLUMNS = [
  'id',
  'email',
  'password_hash',
  'session_version',
  'last_login_at',
  'created_at',
  'updated_at',
].join(',')

const PUBLIC_EDITOR_COLUMNS = [
  'id',
  'email',
  'last_login_at',
  'created_at',
  'updated_at',
].join(',')

export async function listDashboardBlogEditors(): Promise<PublicDashboardBlogEditor[]> {
  const { data, error } = await getSupabaseAdmin()
    .from('dashboard_blog_editors')
    .select(PUBLIC_EDITOR_COLUMNS)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data as unknown as PublicDashboardBlogEditor[]
}

export async function findDashboardBlogEditorByEmail(
  email: string
): Promise<DashboardBlogEditorRecord | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('dashboard_blog_editors')
    .select(EDITOR_COLUMNS)
    .eq('email', email)
    .maybeSingle()
  if (error) throw error
  return (data as unknown as DashboardBlogEditorRecord | null) ?? null
}

export async function findDashboardBlogEditorSessionById(
  id: string
): Promise<{ id: string; session_version: number } | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('dashboard_blog_editors')
    .select('id,session_version')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return (data as { id: string; session_version: number } | null) ?? null
}

export async function createDashboardBlogEditor(input: {
  email: string
  passwordHash: string
}): Promise<PublicDashboardBlogEditor> {
  const { data, error } = await getSupabaseAdmin()
    .from('dashboard_blog_editors')
    .insert({ email: input.email, password_hash: input.passwordHash })
    .select(PUBLIC_EDITOR_COLUMNS)
    .single()
  if (error) throw error
  return data as unknown as PublicDashboardBlogEditor
}

export async function updateDashboardBlogEditorPassword(input: {
  id: string
  passwordHash: string
}): Promise<PublicDashboardBlogEditor | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('dashboard_blog_editors')
    .update({ password_hash: input.passwordHash })
    .eq('id', input.id)
    .select(PUBLIC_EDITOR_COLUMNS)
    .maybeSingle()
  if (error) throw error
  return (data as unknown as PublicDashboardBlogEditor | null) ?? null
}

export async function deleteDashboardBlogEditor(id: string): Promise<boolean> {
  const { data, error } = await getSupabaseAdmin()
    .from('dashboard_blog_editors')
    .delete()
    .eq('id', id)
    .select('id')
    .maybeSingle()
  if (error) throw error
  return Boolean(data)
}

export async function recordDashboardBlogEditorLogin(id: string): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from('dashboard_blog_editors')
    .update({ last_login_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}
