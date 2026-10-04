import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

export function Design() {
  return (
    <main className="mx-auto max-w-md p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Design system</h1>
      <Card>
        <CardHeader><CardTitle>Conversation</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="n">Your name</Label>
            <Input id="n" placeholder="Enze" />
          </div>
          <div className="flex items-center gap-3">
            <Switch id="vo" /><Label htmlFor="vo">Voice-over</Label>
          </div>
          <Button>Start</Button>
        </CardContent>
      </Card>
      <div className="rounded-2xl bg-muted p-4">
        <p className="text-sm text-muted-foreground">안녕하세요</p>
        <p>hello</p>
      </div>
    </main>
  );
}
