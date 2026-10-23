import { LoaderCircle, RotateCcw } from 'lucide-react';

export function RequestState({ loading, error, onRetry }: { loading?: boolean; error?: string; onRetry?: () => void }) {
  return <div className="request-state" role={error ? 'alert' : 'status'}>
    {loading ? <><LoaderCircle size={22} className="spin" /><p>Wczytywanie…</p></> : <>
      <p>{error}</p>{onRetry && <button className="button" onClick={onRetry}><RotateCcw size={15} />Spróbuj ponownie</button>}
    </>}
  </div>;
}
