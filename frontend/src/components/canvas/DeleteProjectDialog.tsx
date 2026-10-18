import { useEffect, useRef, useState } from 'react';
import CanvasDialog from './CanvasDialog';
import { deleteV5 } from '../../domain/plan/storage';
import type { DeleteProjectIntent, DeleteProjectOutcome, ProjectDeletionState } from '../../domain/plan/types';
export default function DeleteProjectDialog({ intent: initial, onCancel, onDone, refreshIntent, onConfirm = (intent) => deleteV5(intent.projectId, intent.expectedRevision) }: {
  intent: DeleteProjectIntent;
  onCancel: () => void;
  onDone: (outcome: DeleteProjectOutcome) => void;
  refreshIntent?: () => DeleteProjectIntent;
  onConfirm?: (intent: DeleteProjectIntent) => Promise<DeleteProjectOutcome>;
}) {
  const [intent, setIntent] = useState(initial);
  const [state, setState] = useState<ProjectDeletionState>('confirming');
  const [error, setError] = useState('');
  const running = useRef(false), live = useRef(true), attempt = useRef('');
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  async function confirm() {
    if (running.current) return;
    running.current = true;
    const requestId = crypto.randomUUID(); attempt.current = requestId;
    setState('deleting'); setError('');
    try {
      const outcome = await onConfirm({ ...intent, requestId });
      if (!live.current || attempt.current !== requestId) return;
      if (outcome.status === 'conflict') {
        setIntent({ ...intent, ...refreshIntent?.(), name: outcome.current.name, address: outcome.current.address,
          expectedRevision: outcome.current.documentRevision, localRevision: refreshIntent?.().localRevision, requestId });
        setState('conflict');
        setError('Проект изменён. Проверьте актуальные данные и подтвердите удаление ещё раз.');
      } else { setState('deleted'); onDone(outcome); }
    } catch (e) {
      if (live.current && attempt.current === requestId) { setState('failed'); setError((e as Error).message); }
    } finally { if (attempt.current === requestId) running.current = false; }
  }
  return <CanvasDialog title="Удалить проект" onCancel={() => { if (!running.current) onCancel(); }}>
    <p><strong>{intent.name}</strong></p>
    {intent.address && <p>{intent.address}</p>}
    <p>Проект и всё его рабочее содержимое будут удалены. Отменить удаление нельзя, корзины нет.</p>
    {error && <p role="alert" className="error">{error}</p>}
    <div className="delete-project-actions">
      <button disabled={state === 'deleting'} onClick={onCancel}>Отмена</button>
      <button className="danger" disabled={state === 'deleting'} onClick={confirm}>
        {state === 'deleting' ? 'Удаляем…' : 'Удалить проект'}
      </button>
    </div>
  </CanvasDialog>;
}
