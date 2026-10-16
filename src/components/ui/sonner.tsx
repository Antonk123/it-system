import { useMode } from "@/hooks/useMode";
import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const mode = useMode();

  return (
    <Sonner
      theme={mode}
      className="toaster group"
      // Lift mobile toasts above the fixed BottomTabBar (~3.5rem) + home indicator
      // so save/error confirmations aren't clipped or hidden behind the nav.
      mobileOffset={{ bottom: 'calc(4.5rem + env(safe-area-inset-bottom, 0px))' }}
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
