import { Suspense } from "react";
import MaterialLibraryPage from "@/app/components/MaterialLibraryPage";

export default function MaterialsPage() {
  return <Suspense fallback={<p className="p-8">Loading materials…</p>}><MaterialLibraryPage /></Suspense>;
}
