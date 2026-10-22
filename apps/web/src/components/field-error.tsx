// One field error line for forms: announced as an alert and id-matched so
// inputs can reference it with aria-describedby. Shows the first server or
// client message for that field.

export function FieldError({
  id,
  message,
}: {
  id: string;
  message?: string | null;
}) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-sm text-destructive">
      {message}
    </p>
  );
}
