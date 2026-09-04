// src/app/add-recipe/page.tsx
import type { Metadata } from "next";

import { AddRecipeForm } from "./AddRecipeForm";

export const metadata: Metadata = {
  title: "Add Your Recipe — The Kranti Cookbook",
  description: "Contribute your family's recipe to the community archive.",
};

export default function AddRecipePage() {
  return <AddRecipeForm />;
}
