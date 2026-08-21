import AuthLayout from '@/components/common/layout/auth-layout';
import { Button } from '@/components/ui/button';

export default function Register() {
  return (
    <AuthLayout>
      <div className="flex w-full items-center justify-center bg-background px-6 py-12 lg:w-1/2">
        <div className="w-full max-w-md space-y-8">
          <div className="space-y-2 text-center lg:text-left">
            <h1 className="text-balance text-2xl font-semibold tracking-tight">
              Administrator setup required
            </h1>
            <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
              Administrator setup must be completed on the host before anyone
              can sign in. The installer creates the account through a private,
              one-time provisioning service.
            </p>
          </div>
          <div className="space-y-3 rounded-lg border bg-muted/40 p-4">
            <p className="text-sm font-medium">Run from the Open-ASM directory:</p>
            <code className="block overflow-x-auto rounded-md border bg-background px-3 py-2 text-sm">
              ./scripts/install.sh
            </code>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Enter the administrator email and password in the host terminal.
              They cannot be submitted through this public page.
            </p>
          </div>
          <Button
            type="button"
            className="w-full"
            size="lg"
            onClick={() => window.location.reload()}
          >
            Check setup status
          </Button>
        </div>
      </div>
    </AuthLayout>
  );
}
