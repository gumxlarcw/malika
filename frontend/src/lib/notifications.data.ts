export type NotificationItem = {
  id: string;
  userName: string;
  userImageSrc: string;
  statusDotClass: string;
  actionText: string;
  targetText: string;
  category: string;
  timeAgo: string;
  createdAt?: string | null;
  link?: string | null;
};

export const NOTIFICATION_ITEMS: NotificationItem[] = [
  {
    id: "terry-5m",
    userName: "Terry Franci",
    userImageSrc: "/images/user/user-02.jpg",
    statusDotClass: "bg-success-500",
    actionText: "requests permission to change",
    targetText: "Project - Nganter App",
    category: "Project",
    timeAgo: "5 min ago",
  },
  {
    id: "alena-8m",
    userName: "Alena Franci",
    userImageSrc: "/images/user/user-03.jpg",
    statusDotClass: "bg-success-500",
    actionText: "requests permission to change",
    targetText: "Project - Nganter App",
    category: "Project",
    timeAgo: "8 min ago",
  },
  {
    id: "jocelyn-15m",
    userName: "Jocelyn Kenter",
    userImageSrc: "/images/user/user-04.jpg",
    statusDotClass: "bg-success-500",
    actionText: "requests permission to change",
    targetText: "Project - Nganter App",
    category: "Project",
    timeAgo: "15 min ago",
  },
  {
    id: "brandon-1h",
    userName: "Brandon Philips",
    userImageSrc: "/images/user/user-05.jpg",
    statusDotClass: "bg-error-500",
    actionText: "requests permission to change",
    targetText: "Project - Nganter App",
    category: "Project",
    timeAgo: "1 hr ago",
  },
];
