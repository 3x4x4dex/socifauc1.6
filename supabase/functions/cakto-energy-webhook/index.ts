import { createClient } from 'npm:@supabase/supabase-js@2';

const webhookSecret = Deno.env.get('CAKTO_WEBHOOK_SECRET') || '';
const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const expectedCheckoutPath = '/seyuwav_1131179';
const timestampToleranceSeconds = 5 * 60;

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

function constantTimeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) mismatch |= a[index] ^ b[index];
  return mismatch === 0;
}

async function verifySignature(rawBody: Uint8Array, timestamp: string, signatureHeader: string): Promise<boolean> {
  const seconds = Number(timestamp);
  if (!Number.isInteger(seconds) || Math.abs(Date.now() / 1000 - seconds) > timestampToleranceSeconds) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(webhookSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const prefix = new TextEncoder().encode(`${timestamp}.`);
  const signedPayload = new Uint8Array(prefix.length + rawBody.length);
  signedPayload.set(prefix, 0);
  signedPayload.set(rawBody, prefix.length);
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, signedPayload));
  const expected = `v1=${[...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  return signatureHeader.split(',').some((entry) => constantTimeEqual(entry.trim(), expected));
}

function isExpectedCheckout(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    const checkout = new URL(value);
    return checkout.protocol === 'https:'
      && checkout.hostname === 'pay.cakto.com.br'
      && checkout.pathname.replace(/\/$/, '') === expectedCheckoutPath;
  } catch {
    return false;
  }
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });
  if (!webhookSecret || !supabaseUrl || !serviceRoleKey) {
    console.error('Cakto webhook environment is not configured');
    return new Response('webhook not configured', { status: 500 });
  }

  const timestamp = request.headers.get('X-Cakto-Timestamp') || '';
  const signature = request.headers.get('X-Cakto-Signature') || '';
  const rawBody = new Uint8Array(await request.arrayBuffer());
  if (!signature || !await verifySignature(rawBody, timestamp, signature)) {
    return new Response('invalid signature', { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    return new Response('invalid JSON', { status: 400 });
  }
  if (typeof payload.secret !== 'string' || !constantTimeEqual(payload.secret, webhookSecret)) {
    return new Response('invalid webhook secret', { status: 401 });
  }

  if (payload.event !== 'purchase_approved') {
    return Response.json({ received: true, ignored: true });
  }

  const orders = Array.isArray(payload.data) ? payload.data : [payload.data];
  let fulfilled = 0;
  let ignored = 0;

  for (const value of orders) {
    if (!value || typeof value !== 'object') {
      ignored += 1;
      continue;
    }
    const order = value as Record<string, unknown>;
    if (order.status !== 'paid' || !isExpectedCheckout(order.checkoutUrl)) {
      ignored += 1;
      continue;
    }
    if (typeof order.id !== 'string' || !isUuid(order.callback)) {
      console.error('Cakto approved order is missing a valid order ID or callback token');
      return new Response('invalid order reference', { status: 400 });
    }

    const { data, error } = await admin.rpc('cakto_fulfill_energy_purchase', {
      p_callback_token: order.callback,
      p_order_id: order.id
    });
    if (error) {
      console.error('Cakto energy fulfillment failed:', error.message);
      return new Response('fulfillment failed; resend this event from Cakto', { status: 503 });
    }
    if (data?.status === 'energy_restored') fulfilled += 1;
    else ignored += 1;
  }

  return Response.json({ received: true, fulfilled, ignored });
});
