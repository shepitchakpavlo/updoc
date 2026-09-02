import { useEffect, useState } from "react";
import { ApiError, createApi, type ApplicationView, type SubmissionView, type UpDocApi } from "./api";
import { SlotCard } from "./SlotCard";

// Мінімальна SPA-форма працівника (тикет 05): лінк /a/{token} показує дані
// заявки і чекліст книжечки; кожен слот приймає один файл, повторне
// завантаження замінює; стан слота і фідбек від API видно одразу.

// Токен заявки — сегмент лінка /a/{token} (тикет 03). У запити до API він
// іде лише в заголовку x-access-token, не в URL (Architecture §5).
export function tokenFromPath(pathname: string): string | null {
  const match = /^\/a\/([^/]+)$/.exec(pathname);
  return match?.[1] ?? null;
}

const LOAD_ERROR = "Не вдалося завантажити форму. Спробуйте ще раз пізніше.";
const UPLOAD_ERROR = "Не вдалося завантажити файл. Спробуйте ще раз.";

export function App() {
  const token = tokenFromPath(window.location.pathname);
  if (token === null) {
    return <main>Невірне посилання</main>;
  }
  return <ApplicationForm token={token} />;
}

export function ApplicationForm({ token, api }: { token: string; api?: UpDocApi }) {
  // Клієнт створюється один раз (lazy initializer): новий об'єкт на кожному
  // рендері міняв би ідентитет у deps ефекту й запускав завантаження по колу
  // (зокрема стираючи фідбек upload). Без api — дефолтний клієнт.
  const [client] = useState(() => api ?? createApi());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [application, setApplication] = useState<ApplicationView | null>(null);
  const [bySlot, setBySlot] = useState<Record<string, SubmissionView>>({});
  const [busySlot, setBusySlot] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([client.getAccess(token), client.getSubmissions(token)])
      .then(([appView, submissions]) => {
        if (cancelled) {
          return;
        }
        setApplication(appView);
        setBySlot(Object.fromEntries(submissions.submissions.map((view) => [view.slot, view])));
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) {
          return;
        }
        setLoadError(err instanceof ApiError ? err.message : LOAD_ERROR);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, token]);

  async function handleUpload(slot: string, file: File) {
    setBusySlot(slot);
    try {
      const result = await client.uploadFile(token, slot, file);
      // Стан і фідбек — одразу з відповіді API: відхилений файл (тикет 06)
      // повертає причину assessment, яку показуємо працівнику без перезапиту.
      setBySlot((prev) => ({ ...prev, [slot]: { slot, status: result.status, feedback: result.feedback } }));
    } catch (err) {
      // Помилка upload (напр. 413 file_too_large) — фідбек слота; стан не змінюється.
      setBySlot((prev) => ({
        ...prev,
        [slot]: { slot, status: prev[slot]?.status ?? "pending", feedback: err instanceof ApiError ? err.message : UPLOAD_ERROR },
      }));
    } finally {
      setBusySlot(null);
    }
  }

  if (loading) {
    return <main>Завантаження…</main>;
  }
  if (loadError !== null || application === null) {
    return <main role="alert">{loadError ?? LOAD_ERROR}</main>;
  }

  return (
    <main>
      <h1>Завантаження документів</h1>
      <p>{application.fullName}</p>
      <p>{application.company}</p>
      <h2>Чекліст</h2>
      {application.checklist.map((slot) => {
        const view = bySlot[slot];
        return (
          <SlotCard
            key={slot}
            slot={slot}
            status={view?.status ?? "pending"}
            feedback={view?.feedback ?? null}
            busy={busySlot === slot}
            onFile={(file) => void handleUpload(slot, file)}
          />
        );
      })}
    </main>
  );
}
