import { useState } from "react";
import { createRoot } from "react-dom/client";
import { CheckCircle2Icon, InfoIcon, TriangleAlertIcon } from "lucide-react";

import { ThemeProvider } from "./theme/ThemeProvider";
import { ThemeSettings } from "./theme/ThemeSettings";
import { Button } from "./components/ui/button";
import { Badge } from "./components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./components/ui/card";
import { Input } from "./components/ui/input";
import { Textarea } from "./components/ui/textarea";
import { Label } from "./components/ui/label";
import { Switch } from "./components/ui/switch";
import { Checkbox } from "./components/ui/checkbox";
import { Slider } from "./components/ui/slider";
import { Progress } from "./components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./components/ui/dialog";
import { Separator } from "./components/ui/separator";
import { Skeleton } from "./components/ui/skeleton";
import { Spinner } from "./components/ui/spinner";

import "./styles/globals.css";

/**
 * Playground entry (index.html → this file). Local component preview only —
 * NOT part of the distributed library surface (see README.md: 源码包形态).
 *
 * Theme preview (P3-9): renders the REAL token system — globals.css imports
 * src/styles/theme.css, ThemeProvider + ThemeSettings drive the same variant
 * store as consumers, and index.html inlines the shared theme-init.js guard.
 * This page is the shortest path to eyeballing every component across the
 * five variants × light/dark (the harness that surfaces theme defects like
 * dark-mode contrast or hardcoded surface colors).
 */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold tracking-wide text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

function Gallery() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectValue, setSelectValue] = useState("");

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex max-w-3xl flex-col gap-10 px-6 py-10">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">WorkPaw UI Playground</h1>
          <p className="text-sm text-muted-foreground">
            真实主题预览（五主题 × 明暗）：token 真相源 = src/styles/theme.css，
            与消费端同源的 ThemeProvider / theme-init.js。切换下方主题与模式目检全部组件。
          </p>
        </header>

        <ThemeSettings />

        <Section title="Button">
          <div className="flex flex-wrap items-center gap-2">
            <Button>主操作</Button>
            <Button variant="secondary">次要</Button>
            <Button variant="outline">轮廓</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">危险操作</Button>
            <Button variant="link">链接</Button>
            <Button size="sm">小号</Button>
            <Button size="lg">大号</Button>
            <Button disabled>禁用</Button>
          </div>
        </Section>

        <Section title="Badge（含状态变体）">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>default</Badge>
            <Badge variant="secondary">secondary</Badge>
            <Badge variant="outline">outline</Badge>
            <Badge variant="ghost">ghost</Badge>
            <Badge variant="link">link</Badge>
            <Badge variant="destructive">destructive</Badge>
            <Badge variant="success">success</Badge>
            <Badge variant="warning">warning</Badge>
            <Badge variant="info">info</Badge>
          </div>
        </Section>

        <Section title="Alert（含状态变体）">
          <div className="grid gap-3">
            <Alert>
              <InfoIcon />
              <AlertTitle>默认</AlertTitle>
              <AlertDescription>中性信息提示文案。</AlertDescription>
            </Alert>
            <Alert variant="success">
              <CheckCircle2Icon />
              <AlertTitle>成功</AlertTitle>
              <AlertDescription>操作已完成并写入。</AlertDescription>
            </Alert>
            <Alert variant="warning">
              <TriangleAlertIcon />
              <AlertTitle>警告</AlertTitle>
              <AlertDescription>配置尚未保存，刷新后会丢失。</AlertDescription>
            </Alert>
            <Alert variant="info">
              <InfoIcon />
              <AlertTitle>信息</AlertTitle>
              <AlertDescription>新版本将在下周推送。</AlertDescription>
            </Alert>
            <Alert variant="destructive">
              <TriangleAlertIcon />
              <AlertTitle>错误</AlertTitle>
              <AlertDescription>删除操作不可撤销。</AlertDescription>
            </Alert>
          </div>
        </Section>

        <Section title="Card">
          <Card>
            <CardHeader>
              <CardTitle>卡片标题</CardTitle>
              <CardDescription>扁平卡面（1px 边框、无静态阴影）。</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                卡片内容文本，检查 card / popover 面上的次要文字对比度。
              </p>
            </CardContent>
          </Card>
        </Section>

        <Section title="表单控件">
          <div className="grid max-w-md gap-4">
            <div className="grid gap-2">
              <Label htmlFor="pg-input">输入框</Label>
              <Input id="pg-input" placeholder="占位文本" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pg-textarea">多行输入</Label>
              <Textarea id="pg-textarea" rows={3} placeholder="占位文本" />
            </div>
            <div className="flex items-center gap-3">
              <Switch id="pg-switch" defaultChecked />
              <Label htmlFor="pg-switch">开关</Label>
            </div>
            <div className="flex items-center gap-3">
              <Checkbox id="pg-checkbox" defaultChecked />
              <Label htmlFor="pg-checkbox">复选框</Label>
            </div>
            <div className="grid gap-2">
              <Label>滑块</Label>
              <Slider defaultValue={[40]} max={100} step={1} />
            </div>
            <div className="grid gap-2">
              <Label>进度</Label>
              <Progress value={62} />
            </div>
            <div className="grid gap-2">
              <Label>下拉选择（popper 默认位）</Label>
              <Select value={selectValue} onValueChange={setSelectValue}>
                <SelectTrigger className="w-56">
                  <SelectValue placeholder="选择一项" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="a">选项 A</SelectItem>
                  <SelectItem value="b">选项 B</SelectItem>
                  <SelectItem value="c">选项 C</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </Section>

        <Section title="Tabs">
          <Tabs defaultValue="one">
            <TabsList>
              <TabsTrigger value="one">标签一</TabsTrigger>
              <TabsTrigger value="two">标签二</TabsTrigger>
              <TabsTrigger value="three">标签三</TabsTrigger>
            </TabsList>
            <TabsContent value="one">
              <p className="text-sm text-muted-foreground">
                非激活标签文字使用 muted-foreground（对比度门禁覆盖）。
              </p>
            </TabsContent>
            <TabsContent value="two">
              <p className="text-sm text-muted-foreground">第二个面板。</p>
            </TabsContent>
            <TabsContent value="three">
              <p className="text-sm text-muted-foreground">第三个面板。</p>
            </TabsContent>
          </Tabs>
        </Section>

        <Section title="反馈 / 加载">
          <div className="flex flex-wrap items-center gap-6">
            <Spinner />
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-20" />
            </div>
          </div>
        </Section>

        <Section title="Dialog（长内容滚动 + 常驻关闭按钮）">
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">打开对话框</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>长内容对话框</DialogTitle>
                <DialogDescription>
                  滚动下方占位内容：右上角关闭按钮应始终可见（滚动收在内容区）。
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-2 text-sm text-muted-foreground">
                {Array.from({ length: 14 }, (_, i) => (
                  <p key={i}>占位段落 {i + 1}：检查对话框滚动时关闭按钮位置保持不变。</p>
                ))}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>
                  取消
                </Button>
                <Button onClick={() => setDialogOpen(false)}>确认</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </Section>

        <Separator />

        <footer className="pb-6 text-xs text-muted-foreground">
          仅本地预览，与库的分发无关；新增组件时在此补一行 demo，主题缺陷先在这里复现。
        </footer>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <ThemeProvider>
    <Gallery />
  </ThemeProvider>,
);
