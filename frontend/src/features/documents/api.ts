import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError, getCsrfToken } from '@/lib/api/client';

export interface DocumentUploadValues {
  doc_type: string;
  title: string;
  notes: string;
  client_id: string;
  property_id: string;
  contract_id: string;
  file: File | null;
}

export interface UploadedDocument {
  id: number;
  doc_type: string;
  title: string | null;
  download_url: string;
}

export const documentKeys = {
  all: ['documents'] as const,
};

/**
 * Multipart upload — deliberately NOT the shared `api` client, which always
 * JSON-stringifies the body and force-sets Content-Type: application/json.
 * A file upload needs a browser-generated multipart boundary instead.
 */
export function useUploadDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: DocumentUploadValues) => {
      if (!values.file) throw new ApiError('Seleziona un file.', 400);
      const formData = new FormData();
      formData.append('doc_type', values.doc_type);
      formData.append('title', values.title);
      formData.append('notes', values.notes);
      if (values.client_id) formData.append('client_id', values.client_id);
      if (values.property_id) formData.append('property_id', values.property_id);
      if (values.contract_id) formData.append('contract_id', values.contract_id);
      formData.append('file', values.file);

      const csrf = getCsrfToken();
      const res = await fetch('/api/documents.php', {
        method: 'POST',
        credentials: 'include',
        headers: csrf ? { 'X-CSRF-TOKEN': csrf } : undefined,
        body: formData,
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload || payload.success === false) {
        throw new ApiError(payload?.error ?? `Caricamento non riuscito (${res.status}).`, res.status);
      }
      return payload.data as UploadedDocument;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: documentKeys.all }),
  });
}
