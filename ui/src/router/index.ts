import { createRouter, createWebHistory } from "vue-router";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      name: "legacy",
      component: () => import("../App.vue"),
    },
    {
      path: "/v2",
      name: "home",
      component: () => import("../views/HomeView.vue"),
      children: [
        {
          path: "",
          redirect: "/v2/label",
        },
        {
          path: "label",
          name: "label",
          component: () => import("../views/LabelView.vue"),
        },
        {
          path: "train",
          name: "train",
          component: () => import("../views/TrainView.vue"),
        },
        {
          path: "classify",
          name: "classify",
          component: () => import("../views/ClassifyView.vue"),
        },
      ],
    },
  ],
});

export default router;
