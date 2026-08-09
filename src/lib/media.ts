import outputs from '@/../amplify_outputs.json'

type StorageOutputs = { storage?: { bucket_name?: string; aws_region?: string } }

export function mediaUrl(value: string | null | undefined): string | null {
  if (!value) return null
  if (/^https:\/\//i.test(value)) return value

  const storage = (outputs as StorageOutputs).storage
  if (!storage?.bucket_name || !storage.aws_region) return null
  const key = value.replace(/^\/+/, '')
  return `https://${storage.bucket_name}.s3.${storage.aws_region}.amazonaws.com/${encodeURI(key)}`
}
