import { createFileRoute } from '@tanstack/react-router';
import AddTarget from '@/pages/targets/add-target';

export const Route = createFileRoute('/_authed/targets/add-target')({
  component: () => (
      <AddTarget />
  ),
});
