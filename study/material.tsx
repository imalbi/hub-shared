import { useState, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { RegistryButton } from '../../apps/web/src/components/registry-button.tsx';
import { getToken } from '../../apps/web/src/lib/auth.ts';
import { m } from './copy.ts';
import { useStudyTRPC } from './use-study.ts';

export function MaterialAction({
  path,
  folder,
  page,
  download = false,
  label,
  name,
  icon,
}: {
  path: string;
  folder?: number;
  page?: number;
  download?: boolean;
  /** Visible text; defaults to Apri or Scarica. */
  label?: string;
  /** Accessible name when it says more than the label. */
  name?: string;
  icon?: ReactNode;
}) {
  const [error, setError] = useState<string | null>(null);
  const trpc = useStudyTRPC();
  const open = useMutation(trpc.openMaterial.mutationOptions());
  async function act() {
    setError(null);
    const tab = download ? null : window.open('', '_blank');
    if (!download && !tab) {
      setError(m.study_material_popup_blocked());
      throw new Error(m.study_material_popup_blocked());
    }
    try {
      const file = await open.mutateAsync({ path, folder });
      const token = getToken();
      const response = await fetch(`/files/${file.fileId}${download ? '' : '?inline=1'}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) throw new Error(m.study_material_unavailable());
      const url = URL.createObjectURL(await response.blob());
      if (tab) tab.location.href = `${url}${page ? `#page=${page}` : ''}`;
      else {
        const link = document.createElement('a');
        link.href = url;
        link.download = file.name;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
    } catch {
      tab?.close();
      setError(m.study_material_unavailable());
      throw new Error(m.study_material_unavailable());
    }
  }
  return (
    <>
      <RegistryButton
        secondary
        label={label ?? (download ? m.study_download() : m.study_open_material())}
        name={name}
        icon={icon}
        action={act}
      />
      {error && <p role="alert">{error}</p>}
    </>
  );
}
