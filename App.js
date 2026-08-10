import React, { useState, useMemo, useEffect, useRef } from 'react';
import { StatusBar, StyleSheet, Text, View, ScrollView, TouchableOpacity, TextInput, Modal, Button, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets, SafeAreaView } from 'react-native-safe-area-context';
import {  db,  registerWithEmail,  loginWithEmail,  setAuthToken,  clearAuthToken,  deleteCurrentAccount,  reauthenticateCurrentUser,  refreshAuthToken} from './firebase';
import * as Clipboard from 'expo-clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Calendar } from 'react-native-calendars';
import * as Updates from 'expo-updates';
function AppContent() {
//=========General=========
//safe view
const scrollViewRef = useRef(null);
const insets = useSafeAreaInsets();
//一鍵返回最頂
const [showScrollTopBtn, setShowScrollTopBtn] = useState(false);

//key
const SAVED_LOGIN_KEY = 'what_are_we_gonna_eat_saved_login_v1';
const LAST_SELECTION_KEY = 'what_are_we_gonna_eat_last_selection_v1';
const LAST_FRUIT_SELECTION_KEY = 'what_are_we_gonna_eat_last_fruit_selection_v1';

  // 主App分頁: 'home', 'group', 'add', 'profile'
  const [currentTab, setCurrentTab] = useState('home');
  const CURRENT_DATE = new Date();

// 流程導航: 'login' -> 'register' -> 'group_setup' -> 'main'
const [appStage, setAppStage] = useState('login');
// 用途：App 開啟時，先檢查手機是否已有登入紀錄
const [isCheckingSavedLogin, setIsCheckingSavedLogin] = useState(true);
//
const showMessage = (title, message = '') => {
  if (Platform.OS === 'web') {
    alert(message ? `${title}\n${message}` : title);

  } else {
    Alert.alert(title, message);
  }
};
//=========註冊/登入=========
 // 用戶與註冊狀態
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [inputInviteCode, setInputInviteCode] = useState('');
  const [userRole, setUserRole] = useState('eat');
  const [familyGroupName, setFamilyGroupName] = useState('');
  const [groupInviteCode, setGroupInviteCode] = useState('');
  const [groupRole, setGroupRole] = useState('member');

// 用途：記錄目前群組真正有管理權限的 email
const [groupAdminEmails, setGroupAdminEmails] = useState([]);

// 用途：把登入資料存在手機，之後開 App 可以自動登入
const saveLoginSessionToDevice = async (user, loginEmail) => {
  try {
    const savedEmail = String(loginEmail || '').trim().toLowerCase();

    // 用途：兼容 Firebase Auth 不同 endpoint 的回傳格式
    // signIn / signUp 多數是 idToken、refreshToken、localId
    // refresh token endpoint 多數是 id_token、refresh_token、user_id
    const idToken = user?.idToken || user?.id_token || '';
    const refreshToken = user?.refreshToken || user?.refresh_token || '';
    const localId = user?.localId || user?.userId || user?.user_id || '';

    const expiresInSeconds = Number(user?.expiresIn || user?.expires_in || 3600);

    // 用途：記錄 token 到期時間，提早 5 分鐘當過期，避免 request 時剛好失效
    const expiresAt = Date.now() + Math.max(expiresInSeconds - 300, 60) * 1000;

    if (!savedEmail || !idToken || !localId || !refreshToken) {
      console.log('saveLoginSessionToDevice skipped: invalid user', user);
      return;
    }

    await AsyncStorage.setItem(
      SAVED_LOGIN_KEY,
      JSON.stringify({
        email: savedEmail,
        idToken,
        localId,
        refreshToken,
        expiresAt,
        savedAt: Date.now()
      })
    );
  } catch (error) {
    console.log('saveLoginSessionToDevice error:', error);
  }
};
// 用途：登入成功 / 自動登入成功後，讀取 Firestore 的 user profile，然後決定進 main 還是 group_setup
const loadUserProfileAfterAuth = async (loginEmail) => {
  const users = await db.collection('users').getAll();
  const me = users.find(u => u.email === loginEmail);

  setEmail(loginEmail);

  if (me) {
    setNickname(me.nickname || '');
    setUserRole(me.userRole || 'eat');
    setFamilyGroupName(me.familyGroupName || '');
    setGroupInviteCode(me.groupInviteCode || '');

    let finalGroupRole = 'member';
    let finalAdminEmails = [];

let hasValidGroup = false;

if (me.groupInviteCode) {
  const groups = await db.collection('familyGroups').getAll();
  const safeGroups = Array.isArray(groups) ? groups : [];

  const currentGroup = safeGroups.find(g => g.inviteCode === me.groupInviteCode);

  if (currentGroup) {
    hasValidGroup = true;

    finalAdminEmails = Array.isArray(currentGroup.adminEmails)
      ? currentGroup.adminEmails
      : [];

    finalGroupRole = finalAdminEmails.includes(loginEmail) ? 'admin' : 'member';
  } else {
    setFamilyGroupName('');
    setGroupInviteCode('');
  }
}

setGroupRole(finalGroupRole);
setGroupAdminEmails(finalAdminEmails);

if (hasValidGroup) {
  setAppStage('main');
} else {
  setAppStage('group_setup');
}
  } else {
    setGroupRole('member');
    setGroupAdminEmails([]);
    setAppStage('group_setup');
  }
};

 // 登入與註冊邏輯
   const handleLogin = async () => {
  try {
    const loginEmail = email.trim().toLowerCase();
    const loginPassword = password;

    if (!loginEmail || !loginPassword) {
      return showMessage('請輸入電郵和密碼。');
    }

const user = await loginWithEmail(loginEmail, password);

console.log('LOGIN_RETURN_USER:', user);
console.log('LOGIN_RETURN_KEYS:', user ? Object.keys(user) : 'no user');

if (!user?.idToken || !user?.localId || !user?.refreshToken) {
  return showMessage('登入失敗', '無法取得完整登入資料，請再試一次。');
}

setAuthToken(user.idToken, user.refreshToken, user.expiresIn);

    await saveLoginSessionToDevice(user, loginEmail);

    await loadUserProfileAfterAuth(loginEmail);

    console.log('成功登入:', user.localId);
  } catch (err) {
    console.log('handleLogin error:', err);
    showMessage('登入失敗', err.message || String(err));
  }
};

// 用途：註冊 Firebase Auth 帳號，並建立 users profile
const handleRegister = async () => {
  try {
    const registerEmail = email.trim().toLowerCase();
    const registerPassword = password;

    if (!nickname.trim() || !registerEmail || !registerPassword || !confirmPassword) {
      return showMessage('所有欄位皆為必填。');
    }

    if (registerPassword !== confirmPassword) {
      return showMessage('兩次輸入的密碼不一致。');
    }

    const user = await registerWithEmail(registerEmail, registerPassword);

if (!user?.idToken || !user?.localId || !user?.refreshToken) {
  return showMessage('註冊失敗', '無法取得完整登入資料，請再試一次。');
}

    // 存 token 給 Firestore 用
setAuthToken(user.idToken, user.refreshToken, user.expiresIn);

    // 存登入紀錄到手機，之後開 App 可以自動登入
    await saveLoginSessionToDevice(user, registerEmail);

await db.collection('users').add({
  uid: user.localId,
  email: registerEmail,
  nickname: nickname.trim(),
  userRole: userRole || 'eat',
  familyGroupName: '',
  groupInviteCode: '',
  groupRole: 'member',
  accountStatus: 'active',
  createdAt: new Date()
});

// 剛註冊時未加入任何群組，所以沒有 admin 權限
setEmail(registerEmail);
setNickname(nickname.trim());
setGroupRole('member');
setGroupAdminEmails([]);

setAppStage('group_setup');
  } catch (err) {
    showMessage('註冊失敗', err.message || String(err));
  }
};


// 用途：登出時清除手機內的登入資料
const clearLoginSessionFromDevice = async () => {
  try {
    await AsyncStorage.removeItem(SAVED_LOGIN_KEY);
  } catch (error) {
    console.log('clearLoginSessionFromDevice error:', error);
  }
};

//=========admin權限=========
// 用途：判斷目前登入者是否有管理權限
// 之後一律以 familyGroups.adminEmails 為準
const isCurrentUserAdmin = groupAdminEmails.includes(email);


// 用途：admin 可以將 member 移出目前家庭群組
// 注意：ownerEmail 只作紀錄，所以即使該成員是原建立者，也可以被 admin 移出群組
const handleRemoveGroupMemberByAdmin = async (member) => {
  try {
    if (!isCurrentUserAdmin) {
      return showMessage('只有管理員可以移除群組成員。');
    }

    if (member.isMe) {
      return showMessage('不能移除自己');
    }

    if (!member.email) {
      return showMessage('無法移除此成員。');
    }

    const groups = await db.collection('familyGroups').getAll();
    const currentGroup = groups.find(g => g.inviteCode === groupInviteCode);

    if (!currentGroup) {
      return showMessage('錯誤沒有此群組。');
    }

    const oldMemberEmails = Array.isArray(currentGroup.memberEmails)
      ? currentGroup.memberEmails
      : [];

    const oldMemberNames = Array.isArray(currentGroup.memberNames)
      ? currentGroup.memberNames
      : [];

    const removeIndex = oldMemberEmails.findIndex(e => e === member.email);

    const memberEmails = oldMemberEmails.filter(e => e !== member.email);

    const memberNames =
      removeIndex >= 0
        ? oldMemberNames.filter((_, index) => index !== removeIndex)
        : oldMemberNames.filter(n => n !== member.name);

    let adminEmails = Array.isArray(currentGroup.adminEmails)
      ? currentGroup.adminEmails.filter(e => e !== member.email)
      : [];

    // 如果移除後沒有 admin，就按剩餘成員加入順序補第一位做 admin
    if (adminEmails.length === 0 && memberEmails.length > 0) {
      adminEmails = [memberEmails[0]];
    }

    await db.collection('familyGroups').update(currentGroup.id, {
      groupName: currentGroup.groupName || '',
      inviteCode: currentGroup.inviteCode || '',
      createdByEmail: currentGroup.createdByEmail || '',
      createdByNickname: currentGroup.createdByNickname || '',

      // ownerEmail 只作建立者紀錄，不再影響權限
      ownerEmail: currentGroup.ownerEmail || '',

      // 真正權限來源
      adminEmails: adminEmails,

      memberNames: memberNames,
      memberEmails: memberEmails,
      createdAt: currentGroup.createdAt || new Date()
    });

    const users = await db.collection('users').getAll();
    const targetUser = users.find(u => u.email === member.email);

    // 被移除的人清空群組資料
    if (targetUser) {
      await db.collection('users').update(targetUser.id, {
        uid: targetUser.uid || '',
        email: targetUser.email || '',
        nickname: targetUser.nickname || '',
        userRole: targetUser.userRole || 'eat',
        familyGroupName: '',
        groupInviteCode: '',
        groupRole: 'member',
        accountStatus: targetUser.accountStatus || 'active',
        createdAt: targetUser.createdAt || new Date()
      });
    }

    // 同步更新仍然是 admin 的 users groupRole
    for (const adminEmail of adminEmails) {
      const adminUser = users.find(u => u.email === adminEmail);

      if (adminUser) {
        await db.collection('users').update(adminUser.id, {
          uid: adminUser.uid || '',
          email: adminUser.email || '',
          nickname: adminUser.nickname || '',
          userRole: adminUser.userRole || 'eat',
          familyGroupName: currentGroup.groupName || '',
          groupInviteCode: currentGroup.inviteCode || '',
          groupRole: 'admin',
          accountStatus: adminUser.accountStatus || 'active',
          createdAt: adminUser.createdAt || new Date()
        });
      }
    }

    // 同步本機 adminEmails state
    setGroupAdminEmails(adminEmails);

    await loadGroupMembersFromFirebase();

    showMessage(`已將 ${member.name} 移出群組。`);
  } catch (error) {
    console.log('handleRemoveGroupMemberByAdmin error:', error);
    showMessage('移除成員失敗', error.message || String(error));
  }
};

// 用途：admin 可以指定或取消其他人成為 admin
// 注意：ownerEmail 只作紀錄，不再自動等於 admin
const handleToggleAdmin = async (member) => {
  try {
    if (!isCurrentUserAdmin) {
  return showMessage('只有管理員可以操作。');
}


    if (member.isMe) {
      return showMessage('不能更改自己的管理員身份。');
    }

    if (!member.email) {
      return showMessage('錯誤，無設定此帳為管理員。');
    }

    const groups = await db.collection('familyGroups').getAll();
    const currentGroup = groups.find(g => g.inviteCode === groupInviteCode);

    if (!currentGroup) {
      return showMessage('錯誤', '找不到目前群組資料。');
    }

    let adminEmails = Array.isArray(currentGroup.adminEmails)
      ? [...currentGroup.adminEmails]
      : [];

    const isAlreadyAdmin = adminEmails.includes(member.email);

    if (isAlreadyAdmin) {
      // 不可以取消最後一位 admin，避免整個群組無人可以管理
      if (adminEmails.length <= 1) {
        return showMessage('群組至少需要一位管理員。');
      }

      adminEmails = adminEmails.filter(e => e !== member.email);
    } else {
      adminEmails = [...adminEmails, member.email];
    }

    await db.collection('familyGroups').update(currentGroup.id, {
      groupName: currentGroup.groupName || '',
      inviteCode: currentGroup.inviteCode || '',
      createdByEmail: currentGroup.createdByEmail || '',
      createdByNickname: currentGroup.createdByNickname || '',

      // ownerEmail 只作建立者紀錄，不再影響權限
      ownerEmail: currentGroup.ownerEmail || '',

      // 真正權限來源
      adminEmails: adminEmails,

      memberNames: currentGroup.memberNames || [],
      memberEmails: currentGroup.memberEmails || [],
      createdAt: currentGroup.createdAt || new Date()
    });

    const users = await db.collection('users').getAll();
    const targetUser = users.find(u => u.email === member.email);

    if (targetUser) {
      await db.collection('users').update(targetUser.id, {
        uid: targetUser.uid || '',
        email: targetUser.email || '',
        nickname: targetUser.nickname || '',
        userRole: targetUser.userRole || 'eat',
        familyGroupName: currentGroup.groupName || '',
        groupInviteCode: currentGroup.inviteCode || '',

        // groupRole 只分 admin / member，不再用 owner 做權限
        groupRole: isAlreadyAdmin ? 'member' : 'admin',

        accountStatus: targetUser.accountStatus || 'active',
        createdAt: targetUser.createdAt || new Date()
      });
    }

    // 如果改的是目前本機群組，立即同步 adminEmails state
    setGroupAdminEmails(adminEmails);

    await loadGroupMembersFromFirebase();


  } catch (error) {
    console.log('handleToggleAdmin error:', error);
    showMessage('更新管理員失敗', error.message || String(error));
  }
};
//=========Group member=========
  // 核心成員名單狀態
const [members, setMembers] = useState([
  { id: 'me', name: '吃貨小明 (我自己)', isMe: true, isPrimaryCook: false }
]);

// 用途：控制「修改家庭群組名稱」獨立編輯模式
const [isEditingGroupName, setIsEditingGroupName] = useState(false);
// 用途：控制「家庭群組成員管理」是否進入管理模式
const [isManagingMembers, setIsManagingMembers] = useState(false);

// 用途：真正從 Firebase 讀取的家庭群組成員
const [groupMembers, setGroupMembers] = useState([]);

  // 用於點菜視窗等其他地方的動態組合名單
  const familyMembers = useMemo(() => {
    return members.map(m => m.isMe ? { ...m, name: `${nickname} (我自己)`, isPrimaryCook: userRole === 'cook' } : m);
  }, [members, nickname, userRole]);

  // 編輯模式狀態
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editNickname, setEditNickname] = useState(nickname);
  const [editRole, setEditRole] = useState(userRole);
  const [editGroupName, setEditGroupName] = useState(familyGroupName);
//=========Group setting=========
// 群組碼產生器
const generateInviteCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
};

const generateUniqueInviteCode = async () => {
  const groups = await db.collection('familyGroups').getAll();
const safeGroups = Array.isArray(groups) ? groups : [];

  let newCode = '';
  let exists = true;

  while (exists) {
    newCode = generateInviteCode();
    exists = safeGroups.some(group => group.inviteCode === newCode);
  }

  return newCode;
};
// 用途：長按複製家庭群組代碼
const handleCopyGroupInviteCode = async () => {
  try {
    if (!groupInviteCode) {
      return showMessage('目前沒有群組代碼。');
    }

    await Clipboard.setStringAsync(groupInviteCode);

    showMessage('已複製群組代碼。');
  } catch (error) {
    console.log('handleCopyGroupInviteCode error:', error);
    showMessage('複製失敗', error.message || String(error));
  }
};
//「創建群組」function
// 用途：建立家庭群組，並同步更新自己 users profile
const handleCreateFamilyGroup = async () => {
  try {
    const groupName = familyGroupName.trim() || `${nickname}的家庭群組`;

    const newCode = await generateUniqueInviteCode();

const defaultTagCategories =
  typeof INITIAL_TAG_CATEGORIES !== 'undefined' &&
  INITIAL_TAG_CATEGORIES &&
  typeof INITIAL_TAG_CATEGORIES === 'object' &&
  !Array.isArray(INITIAL_TAG_CATEGORIES)
    ? INITIAL_TAG_CATEGORIES
    : {};


    const groupData = {
      groupName: groupName,
      inviteCode: newCode,
      createdByEmail: email,
      createdByNickname: nickname,

      // 群組權限資料
      ownerEmail: email,
      adminEmails: [email],

      // 群組成員資料
      memberNames: [nickname],
      memberEmails: [email],

      // 用途：群組共用分類 / 標籤設定
      tagCategories: defaultTagCategories,

      createdAt: new Date()
    };

    // 1. 新增群組到 Firebase
    await db.collection('familyGroups').add(groupData);

    // 2. 更新自己 users profile
 const users = await db.collection('users').getAll();
const safeUsers = Array.isArray(users) ? users : [];
const me = safeUsers.find(u => u.email === email);

if (!me?.id) {
  return showMessage('建立群組失敗', '找不到你的用戶資料，請重新登入後再試。');
}

await db.collection('users').update(me.id, {
  uid: me.uid || '',
  email: email,
  nickname: nickname,
  userRole: userRole || 'eat',
  familyGroupName: groupName,
  groupInviteCode: newCode,
  groupRole: 'admin',
  accountStatus: me.accountStatus || 'active',
  createdAt: me.createdAt || new Date()
});

    // 3. 更新本機畫面 state
setFamilyGroupName(groupName);
setGroupInviteCode(newCode);
setGroupRole('admin');
setGroupAdminEmails([email]);

    setAppStage('main');
  } catch (error) {
    console.log('handleCreateFamilyGroup error:', error);
    showMessage('建立群組失敗', error.message || String(error));
  }
};

// 用途：從 Firebase 讀取目前群組的所有成員，並顯示每個人的暱稱和 userRole
const loadGroupMembersFromFirebase = async () => {
  try {
    if (!groupInviteCode) {
      setGroupMembers([]);
      return;
    }

    const groups = await db.collection('familyGroups').getAll();
    const currentGroup = groups.find(g => g.inviteCode === groupInviteCode);

    if (!currentGroup) {
      setGroupMembers([]);
      return;
    }

    const users = await db.collection('users').getAll();

const memberEmails = Array.isArray(currentGroup.memberEmails)
  ? currentGroup.memberEmails
  : [];

const memberNames = Array.isArray(currentGroup.memberNames)
  ? currentGroup.memberNames
  : [];

const currentAdminEmails = Array.isArray(currentGroup.adminEmails)
  ? currentGroup.adminEmails
  : [];

let loadedMembers = [];

    // 優先用 memberEmails，因為 email 可以對應 users 裡面的 userRole
    if (memberEmails.length > 0) {
      loadedMembers = memberEmails.map((memberEmail, index) => {
        const userData = users.find(u => u.email === memberEmail);

return {
  id: userData?.id || memberEmail || String(index),
  email: memberEmail,
  name: userData?.nickname || (memberEmail === email ? nickname : memberEmail),
  userRole: userData?.userRole || (memberEmail === email ? userRole : 'eat'),

  // 用途：現在只用 adminEmails 判斷此成員是否 admin
  groupRole: currentAdminEmails.includes(memberEmail) ? 'admin' : 'member',
  isAdmin: currentAdminEmails.includes(memberEmail),

  isMe: memberEmail === email
};
      });
    } else {
      // 舊資料 fallback：如果舊群組只有 memberNames，仍然先顯示名字
      loadedMembers = memberNames.map((name, index) => {
  return {
    id: `name-${index}`,
    email: '',
    name: name,
    userRole: name === nickname ? userRole : 'eat',
    groupRole: 'member',
    isAdmin: false,
    isMe: name === nickname
  };
});

    }

 // 分頁5：讓「我自己」永遠排在最上面
const sortedMembers = [...loadedMembers].sort((a, b) => {
  if (a.isMe && !b.isMe) return -1;
  if (!a.isMe && b.isMe) return 1;
  return 0;
});

setGroupMembers(sortedMembers);
setGroupAdminEmails(currentAdminEmails);

  } catch (error) {
    console.log('loadGroupMembersFromFirebase error:', error);
    showMessage('載入成員失敗', error.message || String(error));
  }
};

// 用途：切換 / 加入群組，並同步 users profile、familyGroups 成員資料
const handleSwitchOrJoinGroup = async () => {
  try {
    const newCode = inputInviteCode.trim().toUpperCase();

    if (!newCode) {
      return showMessage('請輸入群組邀請碼');
    }

    // 如果本身已經在同一個群組
    if (groupInviteCode && groupInviteCode === newCode) {
      return showMessage('你已經在這個群組。');
    }

    const groups = await db.collection('familyGroups').getAll();
    const targetGroup = groups.find(group => group.inviteCode === newCode);

    if (!targetGroup) {
      return showMessage('邀請碼不符。');
    }

    const users = await db.collection('users').getAll();


    // 1. 如果現在已有群組，先自動退出舊群組

    if (groupInviteCode) {
      const currentGroup = groups.find(g => g.inviteCode === groupInviteCode);

      if (currentGroup) {
        const oldMemberEmails = Array.isArray(currentGroup.memberEmails)
          ? currentGroup.memberEmails
          : [];

        const oldMemberNames = Array.isArray(currentGroup.memberNames)
          ? currentGroup.memberNames
          : [];

        const removeIndex = oldMemberEmails.findIndex(e => e === email);

        const memberEmails = oldMemberEmails.filter(e => e !== email);

        const memberNames =
          removeIndex >= 0
            ? oldMemberNames.filter((_, index) => index !== removeIndex)
            : oldMemberNames.filter(n => n !== nickname);

        let adminEmails = Array.isArray(currentGroup.adminEmails)
          ? currentGroup.adminEmails.filter(e => e !== email)
          : [];

        // 如果退出後沒有 admin，但仍有成員，就按加入次序補第一位成員做 admin
        if (adminEmails.length === 0 && memberEmails.length > 0) {
          adminEmails = [memberEmails[0]];
        }

// 如果自己離開後，群組已經沒有任何成員，就直接刪除群組
if (memberEmails.length === 0) {
  await db.collection('familyGroups').delete(currentGroup.id);
} else {
  await db.collection('familyGroups').update(currentGroup.id, {
    groupName: currentGroup.groupName || '',
    inviteCode: currentGroup.inviteCode || '',
    createdByEmail: currentGroup.createdByEmail || '',
    createdByNickname: currentGroup.createdByNickname || '',

    // ownerEmail 只作建立者紀錄，不再影響權限
    ownerEmail: currentGroup.ownerEmail || '',

    // 真正權限來源
    adminEmails: adminEmails,

    memberNames: memberNames,
    memberEmails: memberEmails,
    createdAt: currentGroup.createdAt || new Date()
  });
}

        // 如果自動補了 admin，同步更新該 user 的 groupRole
        for (const adminEmail of adminEmails) {
          const adminUser = users.find(u => u.email === adminEmail);

          if (adminUser) {
            await db.collection('users').update(adminUser.id, {
              uid: adminUser.uid || '',
              email: adminUser.email || '',
              nickname: adminUser.nickname || '',
              userRole: adminUser.userRole || 'eat',
              familyGroupName: currentGroup.groupName || '',
              groupInviteCode: currentGroup.inviteCode || '',
              groupRole: 'admin',
              accountStatus: adminUser.accountStatus || 'active',
              createdAt: adminUser.createdAt || new Date()
            });
          }
        }
      }
    }


    // 2. 加入新群組

    const updatedMemberNames = Array.isArray(targetGroup.memberNames)
      ? [...targetGroup.memberNames]
      : [];

    const updatedMemberEmails = Array.isArray(targetGroup.memberEmails)
      ? [...targetGroup.memberEmails]
      : [];

    if (!updatedMemberNames.includes(nickname)) {
      updatedMemberNames.push(nickname);
    }

    if (!updatedMemberEmails.includes(email)) {
      updatedMemberEmails.push(email);
    }

    let targetAdminEmails = Array.isArray(targetGroup.adminEmails)
      ? [...targetGroup.adminEmails]
      : [];

    // 防止舊群組沒有 adminEmails，導致全群組無 admin
    // 如果目標群組完全沒有 admin，就按成員加入次序補第一位做 admin
    if (targetAdminEmails.length === 0 && updatedMemberEmails.length > 0) {
      targetAdminEmails = [updatedMemberEmails[0]];
    }

    await db.collection('familyGroups').update(targetGroup.id, {
      groupName: targetGroup.groupName || '',
      inviteCode: targetGroup.inviteCode || '',
      createdByEmail: targetGroup.createdByEmail || '',
      createdByNickname: targetGroup.createdByNickname || '',

      // ownerEmail 只作紀錄
      ownerEmail: targetGroup.ownerEmail || '',

      // 真正權限來源
      adminEmails: targetAdminEmails,

      memberNames: updatedMemberNames,
      memberEmails: updatedMemberEmails,
      createdAt: targetGroup.createdAt || new Date()
    });


    // 3. 更新自己 users profile

    const me = users.find(u => u.email === email);

    const nextGroupRole = targetAdminEmails.includes(email) ? 'admin' : 'member';

    if (me) {
      await db.collection('users').update(me.id, {
        uid: me.uid || '',
        email: email,
        nickname: nickname,
        userRole: userRole || 'eat',
        familyGroupName: targetGroup.groupName || '',
        groupInviteCode: targetGroup.inviteCode || '',

        // 只分 admin / member，不再用 owner 做權限
        groupRole: nextGroupRole,

        accountStatus: me.accountStatus || 'active',
        createdAt: me.createdAt || new Date()
      });
    }

    // 如果剛才自動補了某人做 admin，也同步更新那個人的 users profile
    for (const adminEmail of targetAdminEmails) {
      const adminUser = users.find(u => u.email === adminEmail);

      if (adminUser) {
        await db.collection('users').update(adminUser.id, {
          uid: adminUser.uid || '',
          email: adminUser.email || '',
          nickname: adminUser.nickname || '',
          userRole: adminUser.userRole || 'eat',
          familyGroupName: targetGroup.groupName || '',
          groupInviteCode: targetGroup.inviteCode || '',
          groupRole: 'admin',
          accountStatus: adminUser.accountStatus || 'active',
          createdAt: adminUser.createdAt || new Date()
        });
      }
    }


    // 4. 更新本機 state

    setFamilyGroupName(targetGroup.groupName || '');
    setGroupInviteCode(targetGroup.inviteCode || '');
    setGroupRole(nextGroupRole);
    setGroupAdminEmails(targetAdminEmails);
    setInputInviteCode('');

    // 加入 / 切換群組成功後，進入主畫面
    setAppStage('main');

    // 不要在這裡直接 call loadGroupMembersFromFirebase()
    // 因為 setGroupInviteCode 是非同步，直接 call 可能會讀到舊 groupInviteCode
    // 下面的 useEffect 會在 groupInviteCode 更新後自動重新載入成員

    showMessage(`成功加入群組：${targetGroup.groupName}`);
  } catch (error) {
    console.log('handleSwitchOrJoinGroup error:', error);
    showMessage('加入群組失敗', error.message || String(error));
  }
};

// 用途：當最後一位成員離開群組前，提醒群組資料會被清空
const confirmLastMemberLeaveGroup = () => {
  if (Platform.OS === 'web') {
    const confirmed = window.confirm(
      '你是這個群組最後一位成員。\n\n離開後，這個家庭群組會被刪除，群組資料將會被清空。\n\n你確定要離開嗎？'
    );
    return Promise.resolve(confirmed);
  }

  return new Promise((resolve) => {
    Alert.alert(
      '確認離開群組',
      '你是這個群組最後一位成員。\n\n離開後，這個家庭群組會被刪除，群組資料將會被清空。\n\n你確定要離開嗎？',
      [
        {
          text: '取消',
          style: 'cancel',
          onPress: () => resolve(false)
        },
        {
          text: '確認離開',
          style: 'destructive',
          onPress: () => resolve(true)
        }
      ]
    );
  });
};

const handleLeaveCurrentGroup = async () => {
  try {
    if (!groupInviteCode) {
      return showMessage('你目前未加入任何群組。');
    }

    const groups = await db.collection('familyGroups').getAll();
    const currentGroup = groups.find(g => g.inviteCode === groupInviteCode);

    if (!currentGroup) {
      setFamilyGroupName('');
      setGroupInviteCode('');
      setGroupRole('member');
      setGroupAdminEmails([]);
      setInputInviteCode('');
      setAppStage('group_setup');
      setDynamicCategories(INITIAL_TAG_CATEGORIES);
      return showMessage( '沒有此群組。');
    }


    // 1. 從目前群組移除自己

    const oldMemberEmails = Array.isArray(currentGroup.memberEmails)
      ? currentGroup.memberEmails
      : [];

    const oldMemberNames = Array.isArray(currentGroup.memberNames)
      ? currentGroup.memberNames
      : [];

    const removeIndex = oldMemberEmails.findIndex(e => e === email);

    const memberEmails = oldMemberEmails.filter(e => e !== email);

    const memberNames =
      removeIndex >= 0
        ? oldMemberNames.filter((_, index) => index !== removeIndex)
        : oldMemberNames.filter(n => n !== nickname);

    let adminEmails = Array.isArray(currentGroup.adminEmails)
      ? currentGroup.adminEmails.filter(e => e !== email)
      : [];

    // 如果自己離開後沒有 admin，但仍然有其他成員，就按加入順序補第一位做 admin
    if (adminEmails.length === 0 && memberEmails.length > 0) {
      adminEmails = [memberEmails[0]];
    }


    // 2. 更新 familyGroups

  // 如果自己離開後，群組已經沒有任何成員，就直接刪除群組
if (memberEmails.length === 0) {
  await db.collection('familyGroups').delete(currentGroup.id);
} else {
  await db.collection('familyGroups').update(currentGroup.id, {
    groupName: currentGroup.groupName || '',
    inviteCode: currentGroup.inviteCode || '',
    createdByEmail: currentGroup.createdByEmail || '',
    createdByNickname: currentGroup.createdByNickname || '',

    // ownerEmail 只作建立者紀錄，不再影響權限
    ownerEmail: currentGroup.ownerEmail || '',

    // 真正權限來源
    adminEmails: adminEmails,

    memberNames: memberNames,
    memberEmails: memberEmails,
    createdAt: currentGroup.createdAt || new Date()
  });
}


    // 3. 更新自己 users profile：清空群組資料

    const users = await db.collection('users').getAll();
    const me = users.find(u => u.email === email);

    if (me) {
      await db.collection('users').update(me.id, {
        uid: me.uid || '',
        email: email,
        nickname: nickname,
        userRole: userRole || 'eat',
        familyGroupName: '',
        groupInviteCode: '',
        groupRole: 'member',
        accountStatus: me.accountStatus || 'active',
        createdAt: me.createdAt || new Date()
      });
    }


    // 4. 如果有自動補 admin，同步更新該 admin 的 users profile

    for (const adminEmail of adminEmails) {
      const adminUser = users.find(u => u.email === adminEmail);

      if (adminUser) {
        await db.collection('users').update(adminUser.id, {
          uid: adminUser.uid || '',
          email: adminUser.email || '',
          nickname: adminUser.nickname || '',
          userRole: adminUser.userRole || 'eat',
          familyGroupName: currentGroup.groupName || '',
          groupInviteCode: currentGroup.inviteCode || '',
          groupRole: 'admin',
          accountStatus: adminUser.accountStatus || 'active',
          createdAt: adminUser.createdAt || new Date()
        });
      }
    }


    // 5. 清空本機 state

    setFamilyGroupName('');
    setGroupInviteCode('');
    setGroupRole('member');
    setGroupAdminEmails([]);
    setInputInviteCode('');
    setGroupMembers([]);
    setAppStage('group_setup');
    setCurrentTab('home');

    showMessage('你已離開目前群組。');
  } catch (error) {
    console.log('handleLeaveCurrentGroup error:', error);
    showMessage('離開群組失敗', error.message || String(error));
  }
};
// 用途：儲存個人資料、角色及群組名稱到 Firebase
const handleSaveProfile = async () => {
  try {
    const newNickname = editNickname.trim();
    const newRole = editRole || 'eat';
    const newGroupName = editGroupName.trim();

    console.log('準備儲存 profile');
    console.log('newNickname:', newNickname);
    console.log('newRole:', newRole);
    console.log('newGroupName:', newGroupName);

    if (!newNickname) {
      return showMessage('暱稱不能留空。');
    }

    if (!newGroupName) {
      return showMessage('群組名稱不能留空。');
    }

    // 1. 找回自己的 user profile
    const users = await db.collection('users').getAll();
    const me = users.find(u => u.email === email);

    if (!me) {
      return showMessage('電郵未有登記，請重新登入。');
    }

    let currentGroup = null;
    let currentAdminEmails = Array.isArray(groupAdminEmails) ? groupAdminEmails : [];
    let finalGroupRole = currentAdminEmails.includes(email) ? 'admin' : 'member';

    // 2. 如果有群組，更新 familyGroups 裡面的 groupName 及 memberNames
    if (groupInviteCode) {
      const groups = await db.collection('familyGroups').getAll();
      currentGroup = groups.find(g => g.inviteCode === groupInviteCode);

      if (!currentGroup) {
        return showMessage('沒有此群組，請重新登入。');
      }

      const oldMemberEmails = Array.isArray(currentGroup.memberEmails)
        ? currentGroup.memberEmails
        : [];

      const oldMemberNames = Array.isArray(currentGroup.memberNames)
        ? currentGroup.memberNames
        : [];

      currentAdminEmails = Array.isArray(currentGroup.adminEmails)
        ? currentGroup.adminEmails
        : [];

      finalGroupRole = currentAdminEmails.includes(email) ? 'admin' : 'member';

      // 用 email 的位置來更新 memberNames，避免同名成員被錯改
      const myIndex = oldMemberEmails.findIndex(e => e === email);

      let updatedMemberNames = [...oldMemberNames];

      if (myIndex >= 0) {
        updatedMemberNames[myIndex] = newNickname;
      } else if (!updatedMemberNames.includes(newNickname)) {
        updatedMemberNames.push(newNickname);
      }

      await db.collection('familyGroups').update(currentGroup.id, {
        groupName: newGroupName,
        inviteCode: currentGroup.inviteCode || '',
        createdByEmail: currentGroup.createdByEmail || '',
        createdByNickname: currentGroup.createdByNickname || '',

        // ownerEmail 只作建立者紀錄，不再影響權限
        ownerEmail: currentGroup.ownerEmail || '',

        // 真正權限來源
        adminEmails: currentAdminEmails,

        memberNames: updatedMemberNames,
        memberEmails: oldMemberEmails,
        createdAt: currentGroup.createdAt || new Date()
      });
    }

    // 3. 更新自己 users profile
    await db.collection('users').update(me.id, {
      uid: me.uid || '',
      email: email,
      nickname: newNickname,

      // 重要：這裡一定要用 newRole
      userRole: newRole,

      familyGroupName: groupInviteCode ? newGroupName : '',
      groupInviteCode: groupInviteCode || '',

      // groupRole 只用 admin / member，不再用 owner
      groupRole: finalGroupRole,

      accountStatus: me.accountStatus || 'active',
      createdAt: me.createdAt || new Date()
    });

    // 4. 同步更新同一群組其他成員 users 入面的 familyGroupName 及 groupRole
    if (groupInviteCode) {
      const sameGroupUsers = users.filter(u =>
        u.groupInviteCode === groupInviteCode && u.email !== email
      );

      for (const member of sameGroupUsers) {
        const memberGroupRole = currentAdminEmails.includes(member.email)
          ? 'admin'
          : 'member';

        await db.collection('users').update(member.id, {
          uid: member.uid || '',
          email: member.email || '',
          nickname: member.nickname || '',
          userRole: member.userRole || 'eat',
          familyGroupName: newGroupName,
          groupInviteCode: member.groupInviteCode || '',

          // 同群組其他人也只用 admin / member
          groupRole: memberGroupRole,

          accountStatus: member.accountStatus || 'active',
          createdAt: member.createdAt || new Date()
        });
      }
    }

    // 5. 更新本機畫面 state
    setNickname(newNickname);
    setUserRole(newRole);
    setFamilyGroupName(groupInviteCode ? newGroupName : '');
    setGroupRole(finalGroupRole);
    setGroupAdminEmails(currentAdminEmails);

    setEditNickname(newNickname);
    setEditRole(newRole);
    setEditGroupName(newGroupName);

    setIsEditingProfile(false);

  } catch (error) {
    console.log('handleSaveProfile error:', error);
    showMessage('更新失敗', error.message || String(error));
  }
};
//================logout/delete acc=====================
// 用途：登出帳號，只清除本機登入狀態，不刪除 Firebase 資料
const handleLogout = async () => {
  await clearLoginSessionFromDevice();
  clearAuthToken();

  setEmail('');
  setPassword('');
  setConfirmPassword('');
  setNickname('');
  setInputInviteCode('');
  setUserRole('eat');
  setFamilyGroupName('');
setGroupInviteCode('');
setGroupRole('member');

setIsEditingProfile(false);
setCurrentTab('home');
setAppStage('login');
setDynamicCategories(INITIAL_TAG_CATEGORIES);
  
};


// 用途：刪除帳號前重新輸入密碼確認
const [deleteAccountModalVisible, setDeleteAccountModalVisible] = useState(false);
const [deleteAccountPasswordInput, setDeleteAccountPasswordInput] = useState('');
const [isDeletingAccount, setIsDeletingAccount] = useState(false);

// 用途：在刪除帳號 Modal 裡按「確認刪除」後執行
// 先重新驗證密碼，再真正刪除帳號
const handleConfirmDeleteMyAccount = async () => {
  try {
    if (isDeletingAccount) return;

    if (!deleteAccountPasswordInput.trim()) {
      return showMessage('請輸入帳號密碼，確認刪除帳號。');
    }

    setIsDeletingAccount(true);

    // 先重新驗證身份，成功後 Firebase 才允許刪帳號
    await reauthenticateCurrentUser(email, deleteAccountPasswordInput.trim());

    // 重新驗證成功後，再執行原本的刪帳流程
    await handleDeleteMyAccount(true);

    setDeleteAccountModalVisible(false);
    setDeleteAccountPasswordInput('');
    setIsDeletingAccount(false);
  } catch (error) {
    console.log('handleConfirmDeleteMyAccount error:', error);

    setIsDeletingAccount(false);

    const message = String(error?.message || error);

    if (
      message.includes('CREDENTIAL_TOO_OLD_LOGIN_AGAIN') ||
      message.includes('requires-recent-login') ||
      message.includes('auth/requires-recent-login')
    ) {
      return showMessage(
        '為了保障帳號安全，請重新輸入密碼。'
      );
    }

    if (
      message.includes('INVALID_PASSWORD') ||
      message.includes('wrong-password') ||
      message.includes('auth/wrong-password') ||
      message.includes('INVALID_LOGIN_CREDENTIALS')
    ) {
      return showMessage('密碼錯誤', '你輸入的密碼不正確，請再試一次。');
    }

    showMessage('刪除帳號失敗', error.message || String(error));
  }
};
// 用途：刪除帳號，並處理群組 membership、admin 權限、菜式匿名化
// alreadyReauthenticated = true 代表已經重新輸入密碼驗證，可以正式刪除
const handleDeleteMyAccount = async (alreadyReauthenticated = false) => {
  try {
    // 用途：避免 React Native onPress 傳入 event object，被誤判成 true
    const hasReauthenticated = alreadyReauthenticated === true;

    // 第一次按刪除帳號時，不直接刪，先打開密碼確認 Modal
    if (!hasReauthenticated) {
      setDeleteAccountPasswordInput('');
      setDeleteAccountModalVisible(true);
      return;
    }

    const users = await db.collection('users').getAll();
    const me = users.find(u => u.email === email);

    const groups = await db.collection('familyGroups').getAll();
    const currentGroup = groups.find(g => g.inviteCode === groupInviteCode);


    // 1. 若有群組，先移除 membership 及 admin 身份

    if (currentGroup) {
      const oldMemberEmails = Array.isArray(currentGroup.memberEmails)
        ? currentGroup.memberEmails
        : [];

      const oldMemberNames = Array.isArray(currentGroup.memberNames)
        ? currentGroup.memberNames
        : [];

      const removeIndex = oldMemberEmails.findIndex(e => e === email);

      const memberEmails = oldMemberEmails.filter(e => e !== email);

      const memberNames =
        removeIndex >= 0
          ? oldMemberNames.filter((_, index) => index !== removeIndex)
          : oldMemberNames.filter(n => n !== nickname);

      let adminEmails = Array.isArray(currentGroup.adminEmails)
        ? currentGroup.adminEmails.filter(e => e !== email)
        : [];

      // 如果自己刪帳後群組仍有人，但沒有 admin，就按加入順序補第一位做 admin
      if (adminEmails.length === 0 && memberEmails.length > 0) {
        adminEmails = [memberEmails[0]];
      }

      // 如果自己離開後，群組已經沒有任何成員，先提醒再刪除群組
if (memberEmails.length === 0) {
  const confirmed = await confirmLastMemberLeaveGroup();

  if (!confirmed) {
    return;
  }

  await db.collection('familyGroups').delete(currentGroup.id);
} else {
  await db.collection('familyGroups').update(currentGroup.id, {
    groupName: currentGroup.groupName || '',
    inviteCode: currentGroup.inviteCode || '',
    createdByEmail: currentGroup.createdByEmail || '',
    createdByNickname: currentGroup.createdByNickname || '',

    // ownerEmail 只作建立者紀錄，不再影響權限
    ownerEmail: currentGroup.ownerEmail || '',

    // 真正權限來源
    adminEmails: adminEmails,

    memberNames: memberNames,
    memberEmails: memberEmails,
    createdAt: currentGroup.createdAt || new Date()
  });
}

      // 如果自動補了 admin，同步更新該 admin 的 users profile
      for (const adminEmail of adminEmails) {
        const adminUser = users.find(u => u.email === adminEmail);

        if (adminUser) {
          await db.collection('users').update(adminUser.id, {
            uid: adminUser.uid || '',
            email: adminUser.email || '',
            nickname: adminUser.nickname || '',
            userRole: adminUser.userRole || 'eat',
            familyGroupName: currentGroup.groupName || '',
            groupInviteCode: currentGroup.inviteCode || '',
            groupRole: 'admin',
            accountStatus: adminUser.accountStatus || 'active',
            createdAt: adminUser.createdAt || new Date()
          });
        }
      }
    }


    // 2. 處理 dishes

    const allDishes = await db.collection('dishes').getAll();
    const safeDishes = Array.isArray(allDishes) ? allDishes : [];
    const myDishes = safeDishes.filter(d => d.createdByEmail === email);

    for (const dish of myDishes) {
      const status = String(
        dish.publishStatus ?? (dish.isPublic ? 'approved' : 'private')
      ).trim().toLowerCase();

      // pending 菜：直接刪除
      if (status === 'pending') {
        await db.collection('dishes').delete(dish.id);
      } else {
        // private / approved：保留，但匿名化
        await db.collection('dishes').update(dish.id, {
          name: dish.name || '',
          ingredients: dish.ingredients || '',
          tags: dish.tags || [],
          createdByEmail: '',
          createdByNickname: '已刪除用戶',
          createdByDeleted: true,
          familyGroupName: dish.familyGroupName || '',
          groupCode: dish.groupCode || '',
          isPublic: dish.isPublic || false,
          requestedPublic: dish.requestedPublic || false,
          publishStatus: dish.publishStatus || (dish.isPublic ? 'approved' : 'private'),

          // 保留群組隱藏紀錄
          hiddenForGroups: Array.isArray(dish.hiddenForGroups) ? dish.hiddenForGroups : [],

          createdAt: dish.createdAt || new Date()
        });
      }
    }


    // 3. soft delete user profile

    if (me) {
      await db.collection('users').update(me.id, {
        uid: me.uid || '',
        email: email,
        nickname: nickname,
        userRole: userRole || 'eat',
        familyGroupName: '',
        groupInviteCode: '',
        groupRole: 'member',
        accountStatus: 'deleted',
        deletedAt: new Date(),
        createdAt: me.createdAt || new Date()
      });
    }
    // 4. 刪 Firebase Auth 帳號
    await deleteCurrentAccount();
    // 5. 清本機 state

  await clearLoginSessionFromDevice();

    clearAuthToken();

    setEmail('');
    setPassword('');
    setConfirmPassword('');
    setNickname('');
    setInputInviteCode('');
    setGroupInviteCode('');
    setUserRole('eat');
    setFamilyGroupName('');
    setGroupRole('member');
    setGroupAdminEmails([]);
    setGroupMembers([]);

    setIsEditingProfile(false);
    setIsDishEditMode(false);
    setDishEditSearchQuery('');

    setAppStage('login');
    setCurrentTab('home');

    showMessage('你的帳戶已被刪除');
  } catch (error) {
    console.log('handleDeleteMyAccount error:', error);
    showMessage('刪除帳號失敗', error.message || String(error));
  }
};
//=========分頁1=========

// 常見食材與分類庫
const INITIAL_TAG_CATEGORIES = {
  ingredients: {
    title: '🥩 食物種類',
    isNested: true,
    subCategories: {
      meat: { title: '🍖 肉類與蛋類', tags: ['🐷 豬肉', '🥩 牛肉', '🐔 雞肉', '🐑 羊肉', '🦆 鴨肉', '🥚 蛋類'] },
      vegie: { title: '🥬 蔬菜與豆品', tags: ['🥬 葉菜', '🥕 根莖', '🍄 菇菌', '🫘 豆類', '🧀 豆腐', '🌽 瓜果', '🌽 栗米'] },
      seafood: { title: '🐟 海鮮類', tags: ['🐟 魚', '🦐 蝦', '🦀 蟹', '🦪 貝', '🦑 魷魚'] },
      staple: { title: '🍚 主食與麵點', tags: ['🍚 白飯', '🍜 麵條', '🥟 水餃', '🍞 麵包', '🍞 吐司'] }
    }
  },
  cuisine: { title: '🌐 菜式地區', tags: ['🇨🇳 中式', '🇭🇰 港式', '🇯🇵 日式', '🇰🇷 韓式', '🇹🇭 泰式', '🇮🇹 西式','🇹🇼 台式'] },
  method: { title: '🍳 烹調方式', tags: ['🔥 煎炒', '💨 蒸煮', '♨️ 蒸餸', '🥘 燜燉', '🍗 酥炸', '🥗 涼拌', '🔥 烘烤', '💨 氣炸', '🍲 火鍋', '🍲 湯底', '🔥 鑊氣', '🍲 煲仔飯'] },
  flavour: { title: '😋 味道', tags: ['🍯 酸甜', '🍬 甜', '🍛 咖喱', '🌶️ 辣味', '🧂 清淡'] },
  lifestyle: { title: '🍽️ 菜式類型', tags: ['🍰 甜品', '🥟 點心', '⏱️ 快手菜', '🏠 家常菜', '🥤 茶餐廳', '🍢 大牌檔', '🧓 老火湯', '🥗 低卡減脂', '🌱 純素', '🌱 蔬食'] }
};


const INITIAL_DISHES = [
  { id: '1', name: '番茄炒蛋', tags: ['🥬 葉菜', '🥚 蛋類', '🇭🇰 港式', '⏱️ 快手菜'], ingredients: '番茄、雞蛋', isPublic: true, groupCode: '' }]

const FRUIT_SEASONS = ['全年', '春', '夏', '秋', '冬'];

const INITIAL_FRUITS = [
  { id: 'fruit_apple', name: '蘋果', seasons: ['全年'], isPublic: true, publishStatus: 'approved', groupCode: '', hiddenForGroups: [] },
];
// 用途：取得目前水果優先季節
// 注意：這裡用可調整 mapping，不代表香港四季硬性定義
const getCurrentFruitPrioritySeason = () => {
  const month = CURRENT_DATE.getMonth() + 1;

  const monthToFruitSeason = {
    1: '冬',
    2: '春',
    3: '春',
    4: '春',
    5: '夏',
    6: '夏',
    7: '夏',
    8: '秋',
    9: '秋',
    10: '秋',
    11: '冬',
    12: '冬'
  };

  return monthToFruitSeason[month] || '全年';
};

// 用途：水果季節標籤排序
// 全年永遠第一，其餘由目前優先季節開始輪轉
const getSortedFruitSeasons = () => {
  const baseOrder = ['春', '夏', '秋', '冬'];
  const current = getCurrentFruitPrioritySeason();

  if (!baseOrder.includes(current)) {
    return ['全年', ...baseOrder];
  }

  const startIndex = baseOrder.indexOf(current);

  return [
    '全年',
    ...baseOrder.slice(startIndex),
    ...baseOrder.slice(0, startIndex)
  ];
};
const getFruitEmoji = (fruitName) => {
  const name = String(fruitName || '');

  if (name.includes('蘋果')) return '🍎';
  if (name.includes('香蕉')) return '🍌';
  if (name.includes('橙') || name.includes('柑') || name.includes('橘')) return '🍊';
  if (name.includes('檸檬')) return '🍋';
  if (name.includes('西瓜')) return '🍉';
  if (name.includes('提子') || name.includes('葡萄')) return '🍇';
  if (name.includes('士多啤梨') || name.includes('草莓')) return '🍓';
  if (name.includes('藍莓')) return '🫐';
  if (name.includes('車厘子') || name.includes('櫻桃')) return '🍒';
  if (name.includes('桃')) return '🍑';
  if (name.includes('芒果')) return '🥭';
  if (name.includes('菠蘿') || name.includes('鳳梨')) return '🍍';
  if (name.includes('奇異果')) return '🥝';
  if (name.includes('牛油果')) return '🥑';
  if (name.includes('梨')) return '🍐';
  if (name.includes('椰')) return '🥥';
  if (name.includes('龍眼') || name.includes('荔枝') || name.includes('山竹') || name.includes('榴槤')) return '🥭';

  return '🍈';
};


  // 控制首頁大分類標籤摺疊狀態
  const [expandedCategories, setExpandedCategories] = useState({
    ingredients: false, cuisine: false, method: false, flavour: false, lifestyle: false,
  });


  const toggleCategoryExpand = (key) => {
    setExpandedCategories(prev => ({ ...prev, [key]: !prev[key] }));
  };
  //菜式與標籤 
const [dynamicCategories, setDynamicCategories] = useState(INITIAL_TAG_CATEGORIES);
const [dishes, setDishes] = useState(INITIAL_DISHES);
const [searchQuery, setSearchQuery] = useState('');
const [selectedTags, setSelectedTags] = useState([]);
// 水果專頁 State
const [homeSubPage, setHomeSubPage] = useState('dishes'); // dishes / fruits

const [fruits, setFruits] = useState(INITIAL_FRUITS);
const [fruitSearchQuery, setFruitSearchQuery] = useState('');
const [selectedFruitSeasons, setSelectedFruitSeasons] = useState([]);

const [isFruitEditMode, setIsFruitEditMode] = useState(false);
const [selectedFruitIdsForHide, setSelectedFruitIdsForHide] = useState([]);
const [hiddenFruitsModalVisible, setHiddenFruitsModalVisible] = useState(false);

const [fruitRequestModalVisible, setFruitRequestModalVisible] = useState(false);
const [selectedFruit, setSelectedFruit] = useState(null);

const [fruitTargetName, setFruitTargetName] = useState('');
const [fruitTargetEmail, setFruitTargetEmail] = useState('');
const [fruitTargetDropdownOpen, setFruitTargetDropdownOpen] = useState(false);

const [fruitAutoAddToList, setFruitAutoAddToList] = useState(null);
const [lastFruitTargetEmail, setLastFruitTargetEmail] = useState('');
const [lastFruitTargetName, setLastFruitTargetName] = useState('');

const [newFruitName, setNewFruitName] = useState('');
const [newFruitSeasons, setNewFruitSeasons] = useState([]);
const [newFruitIsPublic, setNewFruitIsPublic] = useState(false);
// 用途：家庭菜餚庫是否進入編輯模式
const [isDishEditMode, setIsDishEditMode] = useState(false);
// 用途：家庭菜餚庫編輯模式下，用來搜尋要隱藏的菜式
const [dishEditSearchQuery, setDishEditSearchQuery] = useState('');
// 用途：家庭菜餚庫編輯模式下，記錄已勾選要隱藏的菜式 id
const [selectedDishIdsForHide, setSelectedDishIdsForHide] = useState([]); 
// 用途：控制「已隱藏菜式管理」Modal
const [hiddenDishesModalVisible, setHiddenDishesModalVisible] = useState(false);

// 用途：批量修改菜式標籤 Modal
const [bulkDishTagModalVisible, setBulkDishTagModalVisible] = useState(false);
const [bulkAddDishTags, setBulkAddDishTags] = useState([]);
const [bulkRemoveDishTags, setBulkRemoveDishTags] = useState([]);
const [bulkTagEditMode, setBulkTagEditMode] = useState('add'); // 'add' | 'remove'.

const renderBulkTagPicker = (mode) => {
  const isAddMode = mode === 'add';

  const selectedList = isAddMode
    ? bulkAddDishTags
    : bulkRemoveDishTags;

  const setSelectedList = isAddMode
    ? setBulkAddDishTags
    : setBulkRemoveDishTags;

  const setOppositeList = isAddMode
    ? setBulkRemoveDishTags
    : setBulkAddDishTags;

  const selectedStyle = isAddMode
    ? styles.miniSelectBtnActive
    : styles.bulkRemoveTagSelected;

  return (
    <>
      {getSortedCategoryKeys().map(key => {
        const cat = dynamicCategories[key];

        return (
          <View key={`bulk-${mode}-${key}`} style={styles.addCategoryBlock}>
            <Text style={styles.miniCategoryLabel}>
              {cat.title}
            </Text>

            {cat.isNested ? (
              getSortedSubCategoryKeys(key).map(subKey => (
                <View
                  key={`bulk-${mode}-${key}-${subKey}`}
                  style={styles.addSubCategoryBlock}
                >
                  <Text style={styles.miniCategoryLabel}>
                    └ {cat.subCategories[subKey].title}
                  </Text>

                  <View style={styles.tagContainer}>
                    {getSortedTags(cat.subCategories[subKey].tags, key, subKey).map(tag => {
                      const isSelected = selectedList.includes(tag);

                      return (
                        <TouchableOpacity
                          key={`${mode}-${tag}`}
                          style={[
                            styles.miniSelectBtn,
                            isSelected && selectedStyle
                          ]}
                          onPress={() => {
                            setSelectedList(prev =>
                              prev.includes(tag)
                                ? prev.filter(x => x !== tag)
                                : [...prev, tag]
                            );

                            // 同一個 tag 不應同時加入和移除
                            setOppositeList(prev =>
                              prev.filter(x => x !== tag)
                            );
                          }}
                        >
                          <Text
                            style={[
                              styles.miniSelectBtnText,
                              isSelected && styles.miniSelectBtnTextActive
                            ]}
                          >
                            {tag}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              ))
            ) : (
              <View style={styles.tagContainer}>
                {getSortedTags(cat.tags, key).map(tag => {
                  const isSelected = selectedList.includes(tag);

                  return (
                    <TouchableOpacity
                      key={`${mode}-${tag}`}
                      style={[
                        styles.miniSelectBtn,
                        isSelected && selectedStyle
                      ]}
                      onPress={() => {
                        setSelectedList(prev =>
                          prev.includes(tag)
                            ? prev.filter(x => x !== tag)
                            : [...prev, tag]
                        );

                        // 同一個 tag 不應同時加入和移除
                        setOppositeList(prev =>
                          prev.filter(x => x !== tag)
                        );
                      }}
                    >
                      <Text
                        style={[
                          styles.miniSelectBtnText,
                          isSelected && styles.miniSelectBtnTextActive
                        ]}
                      >
                        {tag}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>
        );
      })}
    </>
  );
};
// 用途：目前家庭群組在 Firestore 的 document id
const [currentGroupDocId, setCurrentGroupDocId] = useState('');

// 用途：本群組對公開 / 私房菜式的標籤加減紀錄
// 格式：{ [dishId]: { addedTags: [], removedTags: [] } }
const [dishTagOverrides, setDishTagOverrides] = useState({});
//=========分頁2=========
//=========月曆/日期=========
//月曆
const formatDateToString = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};
const normalizeDateString = (dateStr) => {
  if (!dateStr || typeof dateStr !== 'string') {
    return '';
  }

  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;

  const y = parts[0];
  const m = String(parts[1]).padStart(2, '0');
  const d = String(parts[2]).padStart(2, '0');

  return `${y}-${m}-${d}`;
};

const isPastDate = (dateStr) => {
  const normalized = normalizeDateString(dateStr);
  const today = formatDateToString(CURRENT_DATE);
  return normalized < today;
};

//彈月曆
const [calendarVisible, setCalendarVisible] = useState(false);

// 用途：有按鈕選項的提示訊息
const showConfirmMessage = (title, message, buttons = []) => {
  if (Platform.OS === 'web') {
    const confirmed = window.confirm(`${title}\n${message}`);

    if (confirmed) {
      const confirmButton = buttons.find(btn => btn.text !== '先不用' && btn.style !== 'cancel');
      if (confirmButton && typeof confirmButton.onPress === 'function') {
        confirmButton.onPress();
      }
    }

    return;
  }

  Alert.alert(title, message, buttons);
};

//日曆月份 
const [currentYear, setCurrentYear] = useState(CURRENT_DATE.getFullYear());
const [currentMonth, setCurrentMonth] = useState(CURRENT_DATE.getMonth() + 1);
// request response
const getStatusLabel = (status) => {
  switch (status) {
    case 'approved': return '✅ 已同意';
    case 'rejected': return '❌ 已拒絕';
    case 'pending': return '⏳ 等待回應';
    case 'completed': return '✅ 已完成';
    default: return '❓ 未知';
  }
};
//=========分頁3=========
// 特別通知類型設定
const SPECIAL_NOTICE_TYPES = [
  {
    key: 'bringLunch',
    label: '帶午餐',
    icon: '🍱',
    calendarIcon: '•'
  },
  {
    key: 'noLunch',
    label: '不帶午餐',
    icon: '🚫🍱',
    calendarIcon: '•'
  },
  {
    key: 'homeDinner',
    label: '回來吃飯',
    icon: '🍚',
    calendarIcon: '•'
  },
  {
    key: 'noDinner',
    label: '不回來吃飯',
    icon: '🚫🍚',
    calendarIcon: '•'
  },
  {
    key: 'other',
    label: '其他',
    icon: '📝',
    calendarIcon: '•'
  }
];
const getSpecialNoticeMeta = (noticeType, otherText = '') => {
  const found = SPECIAL_NOTICE_TYPES.find(item => item.key === noticeType);

  if (!found) {
    return {
      key: noticeType || '',
      icon: '🔔',
      calendarIcon: '•',
      label: otherText || '特別通知',
      fullLabel: otherText || '特別通知'
    };
  }

  if (noticeType === 'other') {
    const text = String(otherText || '').trim();

    return {
      ...found,
      label: text || '其他',
      fullLabel: text || '其他'
    };
  }

  return {
    ...found,
    fullLabel: found.label
  };
};

const getDateOffsetString = (offsetDays) => {
  const d = new Date(CURRENT_DATE);
  d.setDate(d.getDate() + offsetDays);
  return formatDateToString(d);
};

const getTomorrowDateString = () => {
  return getDateOffsetString(1);
};
const getNoticeTypesFromItem = (item) => {
  if (Array.isArray(item?.noticeTypes)) {
    return item.noticeTypes;
  }

  if (item?.noticeType) {
    return [item.noticeType];
  }

  return [];
};
//
const getSpecialNoticeDisplayText = (notice) => {
  const types = getNoticeTypesFromItem(notice);

  if (types.length === 0) {
    return '🔔 特別通知';
  }

  return types
    .map(typeKey => {
      const meta = getSpecialNoticeMeta(
        typeKey,
        notice?.otherText
      );

      return meta.fullLabel;
    })
    .join('、');
};

// 用途：將同一人、同一日的多筆特別通知合併成一筆顯示資料
const mergeSpecialNotificationsByPersonDate = (items) => {
  const safeItems = Array.isArray(items) ? items : [];
  const map = new Map();

  safeItems.forEach(item => {
    if (!item) return;

    const date = normalizeDateString(item.date || '');
    const senderKey = item.senderEmail || item.senderNickname || 'unknown';

    const key = `${date}|${senderKey}`;

    const itemTypes = getNoticeTypesFromItem(item);
    const itemOtherText = String(item.otherText || '').trim();

    if (!map.has(key)) {
      map.set(key, {
        ...item,

        // 合併後資料
        mergedNoticeIds: item.id ? [item.id] : [],
        mergedOriginalNotices: [item],

        noticeTypes: [],
        otherTexts: []
      });
    }

    const group = map.get(key);

    group.mergedNoticeIds = Array.from(
      new Set([
        ...(group.mergedNoticeIds || []),
        ...(item.id ? [item.id] : [])
      ])
    );

    group.mergedOriginalNotices = [
      ...(Array.isArray(group.mergedOriginalNotices)
        ? group.mergedOriginalNotices
        : []),
      item
    ];

    itemTypes.forEach(typeKey => {
      if (!group.noticeTypes.includes(typeKey)) {
        group.noticeTypes.push(typeKey);
      }
    });

    if (itemTypes.includes('other') && itemOtherText) {
      if (!group.otherTexts.includes(itemOtherText)) {
        group.otherTexts.push(itemOtherText);
      }
    }

    map.set(key, group);
  });

  return Array.from(map.values());
};

// 用途：顯示合併後通知文字
const getMergedSpecialNoticeDisplayText = (noticeGroup) => {
  const types = Array.isArray(noticeGroup?.noticeTypes)
    ? noticeGroup.noticeTypes
    : getNoticeTypesFromItem(noticeGroup);

  const parts = [];

  types.forEach(typeKey => {
    if (typeKey === 'other') return;

    const meta = getSpecialNoticeMeta(typeKey, '');
    parts.push(meta.fullLabel);
  });

  const otherTexts = Array.isArray(noticeGroup?.otherTexts)
    ? noticeGroup.otherTexts
    : [];

  otherTexts.forEach(text => {
    if (text && !parts.includes(text)) {
      parts.push(text);
    }
  });

  if (types.includes('other') && otherTexts.length === 0) {
    parts.push('其他');
  }

  return Array.from(new Set(parts)).join('、') || '特別通知';
};
// 分頁 3：特別通知 State
const [specialNoticeSubPage, setSpecialNoticeSubPage] = useState('overview'); // overview / create

const [specialNotifications, setSpecialNotifications] = useState([]);

const [specialNoticeYear, setSpecialNoticeYear] = useState(CURRENT_DATE.getFullYear());
const [specialNoticeMonth, setSpecialNoticeMonth] = useState(CURRENT_DATE.getMonth() + 1);

const [specialNoticeDateInput, setSpecialNoticeDateInput] = useState(formatDateToString(CURRENT_DATE));
const [specialNoticeTypes, setSpecialNoticeTypes] = useState([]);
const [specialNoticeOtherText, setSpecialNoticeOtherText] = useState('');
const [isSpecialNoticeSubmitting, setIsSpecialNoticeSubmitting] = useState(false);

// 用途：控制「新增特別通知」日期月曆 Modal
const [specialNoticeCalendarVisible, setSpecialNoticeCalendarVisible] = useState(false);

// 用途：前一日特別通知提醒 popup
const [specialNoticeReminderModalVisible, setSpecialNoticeReminderModalVisible] = useState(false);
//=========分頁4=========
//=========分頁5=========
//=========Modal setting=========
//========= 點菜 Modal =========
const [requestModalVisible, setRequestModalVisible] = useState(false);
const [selectedDish, setSelectedDish] = useState(null);


//Modal pending request
const hasShownInboxRef = useRef(false);
const [forceOpenInboxKey, setForceOpenInboxKey] = useState(0);

  // 半分頁專用 State
  const [customModalVisible, setCustomModalVisible] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newModalTagName, setNewModalTagName] = useState('');
  const [selectedModalCat, setSelectedModalCat] = useState('none');
  const [selectedSubModalCat, setSelectedSubModalCat] = useState('');
  const [showMoreModalCats, setShowMoreModalCats] = useState(false);
  const [isEditingCustomTags, setIsEditingCustomTags] = useState(false);
  const [selectedCustomTagNames, setSelectedCustomTagNames] = useState([]);
  const [selectedCustomCategoryKeys, setSelectedCustomCategoryKeys] = useState([]);

  // 下拉選單控制狀態
  const [cookDropdownOpen, setCookDropdownOpen] = useState(false);
  const [mealDropdownOpen, setMealDropdownOpen] = useState(false);
  // 用途：所有可選餐次，點菜和改期都可共用
const MEAL_OPTIONS = ['早餐', '午餐','下午茶', '晚餐',  '宵夜'];
 
const [targetCook, setTargetCook] = useState('');
const [targetCookEmail, setTargetCookEmail] = useState('');

// 用途：提出想吃時選擇餐次
// 不再硬性預設晚餐；如果之前選過，就沿用上一次
const [selectedMeal, setSelectedMeal] = useState('');
const [lastSelectedMeal, setLastSelectedMeal] = useState('');

const saveLastSelectionsToDevice = async (data) => {
  try {
    await AsyncStorage.setItem(
      LAST_SELECTION_KEY,
      JSON.stringify(data)
    );
  } catch (error) {
    console.log('saveLastSelections error:', error);
  }
};

const loadLastSelectionsFromDevice = async () => {
  try {
    const text = await AsyncStorage.getItem(LAST_SELECTION_KEY);

    if (!text) return;

    const data = JSON.parse(text);

    setLastSelectedMeal(data?.meal || '');
    setLastAutoAddToList(data?.autoAdd || null);
    setLastApproveAddToList(data?.approveAdd || null);
  } catch (error) {
    console.log('loadLastSelections error:', error);
  }
};

// 用途：提出想吃時是否加入自己的購物清單
// null = 尚未選擇，true = 加入，false = 不加入
const [autoAddToList, setAutoAddToList] = useState(null);
const [lastAutoAddToList, setLastAutoAddToList] = useState(null);

const [customDateInput, setCustomDateInput] = useState(formatDateToString(CURRENT_DATE));

// 用途：大廚同意 request 時，是否把材料加入購物清單
// null = 尚未選擇，true = 加入，false = 不加入
const [approveAddToList, setApproveAddToList] = useState(null);
const [lastApproveAddToList, setLastApproveAddToList] = useState(null);

// 用途：大廚拒絕 / 取消 request 時填寫原因，可空白
const [rejectModalVisible, setRejectModalVisible] = useState(false);
const [rejectTargetRequest, setRejectTargetRequest] = useState(null);
const [rejectReasonInput, setRejectReasonInput] = useState('');
const FRUIT_REJECT_REASONS = ['不當造', '季節錯誤', '買不到'];
// 用途：大廚改期時填寫原因，可空白
const [rescheduleReasonInput, setRescheduleReasonInput] = useState('');

// 用途：從 Firebase requests collection 讀取的點菜要求
const [requests, setRequests] = useState([]);
// 用途：分頁 2 排餐記錄篩選：all / dish / fruit
const [requestTypeFilter, setRequestTypeFilter] = useState('all');

// 用途：控制收到的點菜要求 Modal
const [requestInboxVisible, setRequestInboxVisible] = useState(false);
// 用途：控制「大廚通知」彈出視窗
const [senderNotificationModalVisible, setSenderNotificationModalVisible] = useState(false);

// 用途：本次 App 使用期間已看過的大廚通知，避免關閉後立即再彈
const [dismissedCookMessageKeys, setDismissedCookMessageKeys] = useState([]);
// 改期專用 Modal State
const [rescheduleModalVisible, setRescheduleModalVisible] = useState(false);
const [rescheduleTargetId, setRescheduleTargetId] = useState(null);
const [rescheduleDateInput, setRescheduleDateInput] = useState('');

// 用途：改期時也可以修改餐次；預設用原本 request 的 meal
const [rescheduleMealInput, setRescheduleMealInput] = useState('');

// 用途：控制改期 Modal 內餐次選項是否展開
const [rescheduleMealOptionsVisible, setRescheduleMealOptionsVisible] = useState(false);

// 用途：避免狂按「確認改期」時重複送出
const [isRescheduleSubmitting, setIsRescheduleSubmitting] = useState(false);

// 用途：判斷 request 是否屬於同一個排餐要求
// 同一群組 + 同一菜式 + 同一日期 + 同一餐次 = 同一個 request
// 不包含 sender，也不包含 targetCook，因為 A給B / B給A 都要合併
// 但一定要包含 date 和 meal，否則 6月4日和6月11日會被錯誤合併
const getRequestUniqueKey = (req) => {
  if (req.requestType === 'fruit') {
    return [
      'fruit',
      req.groupCode || '',
      req.fruitId || req.fruitName || req.dishName || '',
      req.senderEmail || '',
      req.targetPersonEmail || req.targetCookEmail || ''
    ].join('|');
  }

  return [
    'dish',
    req.groupCode || '',
    req.dishId || req.dishName || '',
    req.date || '',
    req.meal || ''
  ].join('|');
};
const saveLastFruitSelectionToDevice = async (data) => {
  try {
    await AsyncStorage.setItem(
      LAST_FRUIT_SELECTION_KEY,
      JSON.stringify(data)
    );
  } catch (error) {
    console.log('saveLastFruitSelection error:', error);
  }
};

const loadLastFruitSelectionFromDevice = async () => {
  try {
    const text = await AsyncStorage.getItem(LAST_FRUIT_SELECTION_KEY);

    if (!text) return;

    const data = JSON.parse(text);

    setLastFruitTargetEmail(data?.targetEmail || '');
    setLastFruitTargetName(data?.targetName || '');
  } catch (error) {
    console.log('loadLastFruitSelection error:', error);
  }
};
//=========useeffect=========
// 用途：App 每次打開時，先檢查手機是否已有登入紀錄；有就用 refreshToken 換新 idToken 再進入 App
useEffect(() => {
  const restoreLoginSessionFromDevice = async () => {
    try {
      const savedLoginText = await AsyncStorage.getItem(SAVED_LOGIN_KEY);

      if (!savedLoginText) {
        setAppStage('login');
        return;
      }

      const savedLogin = JSON.parse(savedLoginText);

      if (!savedLogin?.email || !savedLogin?.refreshToken) {
        await clearLoginSessionFromDevice();
        clearAuthToken();
        setAppStage('login');
        return;
      }
      // 重要：不要長期直接用舊 idToken
      // App 重新開啟時，先用 refreshToken 換新 idToken
      const refreshedUser = await refreshAuthToken(savedLogin.refreshToken);

      if (!refreshedUser?.idToken) {
        await clearLoginSessionFromDevice();
        clearAuthToken();
        setAppStage('login');
        return;
      }

      const nextSession = {
        idToken: refreshedUser.idToken,
        refreshToken: refreshedUser.refreshToken || savedLogin.refreshToken,
        localId: savedLogin.localId || refreshedUser.userId || '',
        expiresIn: refreshedUser.expiresIn || 3600
      };

      // 更新 firebase.js 內記憶體 token
      setAuthToken(
        nextSession.idToken,
        nextSession.refreshToken,
        nextSession.expiresIn
      );

      // 更新手機內保存的最新 token
      await saveLoginSessionToDevice(nextSession, savedLogin.email);

      await loadUserProfileAfterAuth(savedLogin.email);
    } catch (error) {
      console.log('restoreLoginSessionFromDevice error:', error);

      await clearLoginSessionFromDevice();
      clearAuthToken();
      setAppStage('login');
    } finally {
      setIsCheckingSavedLogin(false);
    }
  };

  restoreLoginSessionFromDevice();
}, []);

// 用途：登入、加入群組、切換群組、改暱稱或角色後，自動重新載入 Firebase 成員名單
useEffect(() => {
  if (appStage !== 'main') return;
  if (!email || !groupInviteCode) return;

  loadGroupMembersFromFirebase();
}, [appStage, groupInviteCode, email]);
// 用途：每次打開管理標籤分頁時，編輯區都先收起，並清空已勾選項目
useEffect(() => {
  if (customModalVisible) {
    setIsEditingCustomTags(false);
    setSelectedCustomTagNames([]);
    setSelectedCustomCategoryKeys([]);
  }
}, [customModalVisible]);

//下拉選項
useEffect(() => {
  loadLastSelectionsFromDevice();
}, []);

//=========下面未整理=========



useEffect(() => {
  loadLastFruitSelectionFromDevice();
}, []);

// 用途：家庭動態顯示時，把同一群組 / 同一菜式 / 同一日期 / 同一餐次的 request 合併成一張卡
// 重要：主顯示資料以 updatedAt 最新的一筆為準，避免 cookMessage / rejected / 改期通知被舊資料蓋住
const uniqueRequests = useMemo(() => {
  const map = new Map();

  // 用途：把 Firestore timestamp / Date string 轉成可比較時間
  const getTimeValue = (value) => {
    if (!value) return 0;

    const time = new Date(value).getTime();
    return Number.isNaN(time) ? 0 : time;
  };

  (requests || []).forEach(req => {
    const key = getRequestUniqueKey(req);

    const senderName =
      req.senderNickname ||
      req.sender ||
      req.senderEmail ||
      '未知';

 const targetCookName =
  req.requestType === 'fruit'
    ? (
        req.targetPersonName ||
        req.targetCookName ||
        req.target ||
        req.targetPersonEmail ||
        req.targetCookEmail ||
        '未知'
      )
    : (
        req.targetCookName ||
        req.target ||
        req.targetCookEmail ||
        '未知'
      );

const senderEmail = req.senderEmail || '';

const targetCookEmail =
  req.requestType === 'fruit'
    ? (req.targetPersonEmail || req.targetCookEmail || '')
    : (req.targetCookEmail || '');

    if (!map.has(key)) {
      map.set(key, {
        ...req,

        // 用途：之後同意 / 拒絕 / 改期時，可以一次處理所有合併的 request
        mergedRequestIds: [req.id],

        // 用途：顯示所有發起人
        mergedSenders: [senderName],
        mergedSenderEmails: senderEmail ? [senderEmail] : [],

        // 用途：顯示所有被指定的大廚
        mergedCooks: [targetCookName],
        mergedCookEmails: targetCookEmail ? [targetCookEmail] : []
      });

      return;
    }

    const existing = map.get(key);

    const mergedRequestIds = Array.from(
      new Set([
        ...(existing.mergedRequestIds || []),
        req.id
      ])
    );

    const mergedSenders = Array.from(
      new Set([
        ...(existing.mergedSenders || []),
        senderName
      ])
    );

    const mergedSenderEmails = Array.from(
      new Set([
        ...(existing.mergedSenderEmails || []),
        ...(senderEmail ? [senderEmail] : [])
      ])
    );

    const mergedCooks = Array.from(
      new Set([
        ...(existing.mergedCooks || []),
        targetCookName
      ])
    );

    const mergedCookEmails = Array.from(
      new Set([
        ...(existing.mergedCookEmails || []),
        ...(targetCookEmail ? [targetCookEmail] : [])
      ])
    );

    // 用途：決定這張合併卡主要顯示哪一筆資料
    // 原則：updatedAt 最新的一筆為主
    // 這樣 rejected / cookMessage / rescheduleReason 不會被舊 approved 資料蓋住
    const existingTime = getTimeValue(existing.updatedAt || existing.createdAt);
    const reqTime = getTimeValue(req.updatedAt || req.createdAt);

    const latestBase = reqTime >= existingTime ? req : existing;

    map.set(key, {
      ...latestBase,

      // 保留合併資料
      mergedRequestIds,
      mergedSenders,
      mergedSenderEmails,
      mergedCooks,
      mergedCookEmails
    });
  });

  return Array.from(map.values());
}, [requests]);
// 用途：產生大廚通知唯一 key
// 如果同一 request 後來有新 cookMessage / updatedAt，就會變成新的通知
const getCookMessageKey = (req) => {
  return [
    req.id || '',
    req.updatedAt || '',
    req.cookMessage || ''
  ].join('|');
};
// 用途：目前登入者收到、尚未處理的點菜要求
// 注意：這裡用原始 requests，不用 uniqueRequests
// 因為 inbox 要判斷是否有 request 傳給自己
const incomingRequests = useMemo(() => {
  return (requests || []).filter(req => {
    const targetEmail =
      req.requestType === 'fruit'
        ? (req.targetPersonEmail || req.targetCookEmail)
        : req.targetCookEmail;

    return (
      targetEmail === email &&
      req.status === 'pending'
    );
  });
}, [requests, email]);

// 用途：目前登入者收到大廚改期 / 拒絕 / 取消通知
// 通知對象：其他發起人 + 其他大廚
// 不通知實際操作的大廚自己
const senderNotifications = useMemo(() => {
  return (uniqueRequests || []).filter(req => {
    const senderEmails = Array.isArray(req.mergedSenderEmails)
      ? req.mergedSenderEmails
      : (req.senderEmail ? [req.senderEmail] : []);

    const cookEmails = Array.isArray(req.mergedCookEmails)
      ? req.mergedCookEmails
      : (req.targetCookEmail ? [req.targetCookEmail] : []);

    // 通知對象：發起人或大廚
    const isRelatedPerson =
      email &&
      (
        senderEmails.includes(email) ||
        cookEmails.includes(email)
      );

    const hasMessage =
      req.cookMessage &&
      String(req.cookMessage).trim() !== '';

    // 找出這次通知是誰操作的
    // 改期用 rescheduledByEmail
    // 拒絕 / 取消用 rejectedByEmail
    const actionByEmail =
      req.rescheduledByEmail ||
      req.rejectedByEmail ||
      '';

    // 不通知操作人自己
    const isActionUser = email && actionByEmail === email;

    const readByEmails = Array.isArray(req.cookMessageReadByEmails)
      ? req.cookMessageReadByEmails
      : [];

    const alreadyReadInFirebase =
      email && readByEmails.includes(email);

    const messageKey = getCookMessageKey(req);

    const alreadyDismissedThisSession =
      dismissedCookMessageKeys.includes(messageKey);

    return (
      isRelatedPerson &&
      hasMessage &&
      !isActionUser &&
      !alreadyReadInFirebase &&
      !alreadyDismissedThisSession
    );
  });
}, [uniqueRequests, email, dismissedCookMessageKeys]);



// 用途：如果發起人收到大廚通知，自動彈出「大廚通知」視窗
useEffect(() => {
  if (appStage === 'main' && senderNotifications.length > 0) {
    setSenderNotificationModalVisible(true);
  }

  if (senderNotifications.length === 0) {
    setSenderNotificationModalVisible(false);
  }
}, [appStage, senderNotifications.length]);

// 用途：排序後的家庭動態 request
// completed / rejected 不顯示；pending / approved 顯示
// fruit pending 也要顯示，讓發起人和全群組看到「等待回應」
const sortedRequests = [...(uniqueRequests || [])]
  .filter(req => {
    if (req.status === 'completed' || req.status === 'rejected') {
      return false;
    }

    if (requestTypeFilter === 'dish') {
      return req.requestType !== 'fruit';
    }

    if (requestTypeFilter === 'fruit') {
      return req.requestType === 'fruit';
    }

    return true;
  })
  .sort((a, b) => {
    const dateA = new Date(a.date || '').getTime();
    const dateB = new Date(b.date || '').getTime();

    const safeDateA = Number.isNaN(dateA) ? 0 : dateA;
    const safeDateB = Number.isNaN(dateB) ? 0 : dateB;

    if (safeDateA !== safeDateB) {
      return safeDateA - safeDateB;
    }

    const updatedA = new Date(a.updatedAt || a.createdAt || '').getTime();
    const updatedB = new Date(b.updatedAt || b.createdAt || '').getTime();

    const safeUpdatedA = Number.isNaN(updatedA) ? 0 : updatedA;
    const safeUpdatedB = Number.isNaN(updatedB) ? 0 : updatedB;

    return safeUpdatedB - safeUpdatedA;
  });

// 用途：月曆上標示已同意排餐的日期
// 用 uniqueRequests，避免同一餐多個 request 令月曆重複計算
const approvedDates = Array.from(
  new Set(
    (uniqueRequests || [])
      .filter(req =>
        req.requestType !== 'fruit' &&
        req.status === 'approved' &&
        req.date
      )
      .map(req => normalizeDateString(req.date))
      .filter(Boolean)
  )
);

// 用途：月曆上標示已完成排餐的日期
const completedDates = Array.from(
  new Set(
    (uniqueRequests || [])
      .filter(req =>
        req.requestType !== 'fruit' &&
        req.status === 'completed' &&
        req.date
      )
      .map(req => normalizeDateString(req.date))
      .filter(Boolean)
  )
);
// 用途：把某個大廚通知標記為已讀，並寫入 Firebase
const markCookMessageAsReadInFirebase = async (reqItem) => {
  try {
    if (!email) return;

    const ids = Array.isArray(reqItem?.mergedRequestIds)
      ? reqItem.mergedRequestIds
      : [reqItem?.id];

    const targetRequests = (requests || []).filter(req =>
      ids.includes(req.id)
    );

    for (const targetReq of targetRequests) {
      const oldReadByEmails = Array.isArray(targetReq.cookMessageReadByEmails)
        ? targetReq.cookMessageReadByEmails
        : [];

      const nextReadByEmails = Array.from(
        new Set([...oldReadByEmails, email])
      );

      await db.collection('requests').update(targetReq.id, {
        dishId: targetReq.dishId || '',
        dishName: targetReq.dishName || '',
        ingredients: targetReq.ingredients || '',
requestType: targetReq.requestType || 'dish',
fruitId: targetReq.fruitId || '',
fruitName: targetReq.fruitName || '',
targetPersonEmail: targetReq.targetPersonEmail || '',
targetPersonName: targetReq.targetPersonName || '',
        groupCode: targetReq.groupCode || groupInviteCode || '',
        familyGroupName: targetReq.familyGroupName || familyGroupName || '',

        groupMemberEmails:
          Array.isArray(targetReq.groupMemberEmails) && targetReq.groupMemberEmails.length > 0
            ? targetReq.groupMemberEmails
            : getCurrentGroupMemberEmails(),

        groupAdminEmails:
          Array.isArray(targetReq.groupAdminEmails) && targetReq.groupAdminEmails.length > 0
            ? targetReq.groupAdminEmails
            : (Array.isArray(groupAdminEmails) ? groupAdminEmails : []),

        senderEmail: targetReq.senderEmail || '',
        senderNickname: targetReq.senderNickname || targetReq.sender || '',

        targetCookEmail: targetReq.targetCookEmail || '',
        targetCookName: targetReq.targetCookName || targetReq.target || '',

        date:
  targetReq.requestType === 'fruit'
    ? ''
    : (targetReq.date || ''),
        meal:
  targetReq.requestType === 'fruit'
    ? ''
    : (targetReq.meal || ''),

        status: targetReq.status || 'pending',

        autoAddToList: targetReq.autoAddToList || false,
        cookApprovedAddToList: targetReq.cookApprovedAddToList || false,

        cookMessage: targetReq.cookMessage || '',
        rejectionReason: targetReq.rejectionReason || '',
        rescheduleReason: targetReq.rescheduleReason || '',

        // 重要：把目前登入者記錄為已讀
        cookMessageReadByEmails: nextReadByEmails,

        createdAt: targetReq.createdAt || new Date(),
        updatedAt: targetReq.updatedAt || new Date(),

        approvedAt: targetReq.approvedAt || '',
        approvedByEmail: targetReq.approvedByEmail || '',
        approvedByNickname: targetReq.approvedByNickname || '',

        rejectedAt: targetReq.rejectedAt || '',
        rejectedByEmail: targetReq.rejectedByEmail || '',
        rejectedByNickname: targetReq.rejectedByNickname || '',

        rescheduledAt: targetReq.rescheduledAt || '',
        rescheduledByEmail: targetReq.rescheduledByEmail || '',
        rescheduledByNickname: targetReq.rescheduledByNickname || '',

        completedAt: targetReq.completedAt || '',
        completedByEmail: targetReq.completedByEmail || '',
        completedByNickname: targetReq.completedByNickname || ''
      });
    }
  } catch (error) {
    console.log('markCookMessageAsReadInFirebase error:', error);
    showMessage('已讀失敗', error.message || String(error));
  }
};
// 用途：所有 active 特別通知
const activeSpecialNotifications = useMemo(() => {
  const safeNotifications = Array.isArray(specialNotifications)
    ? specialNotifications
    : [];

  return safeNotifications.filter(item =>
    item && item.status !== 'canceled'
  );
}, [specialNotifications]);

// 用途：判斷目前登入者是否是某日期排餐記錄的大廚
const isCurrentUserCookForMealOnDate = (dateStr) => {
  const normalized = normalizeDateString(dateStr);

  return (uniqueRequests || []).some(req => {
    if (req.requestType === 'fruit') return false;

    const reqDate = normalizeDateString(req.date || '');

    const isActiveMealRecord =
      req.status === 'approved' ||
      req.status === 'completed';

    if (reqDate !== normalized || !isActiveMealRecord) {
      return false;
    }

    const cookEmails = Array.isArray(req.mergedCookEmails)
      ? req.mergedCookEmails
      : (req.targetCookEmail ? [req.targetCookEmail] : []);

    return cookEmails.includes(email);
  });
};

// 用途：判斷目前群組是否有任何主要掌廚
const hasAnyCookInCurrentGroup = useMemo(() => {
  const safeMembers = Array.isArray(groupMembers) ? groupMembers : [];

  return safeMembers.some(member => member.userRole === 'cook');
}, [groupMembers]);

// 用途：判斷某日期是否有任何排餐大廚
const hasAnyMealCookOnDate = (dateStr) => {
  const normalized = normalizeDateString(dateStr);

  return (uniqueRequests || []).some(req => {
    if (req.requestType === 'fruit') return false;

    const reqDate = normalizeDateString(req.date || '');

    const isActiveMealRecord =
      req.status === 'approved' ||
      req.status === 'completed';

    if (reqDate !== normalized || !isActiveMealRecord) {
      return false;
    }

    const cookEmails = Array.isArray(req.mergedCookEmails)
      ? req.mergedCookEmails
      : (req.targetCookEmail ? [req.targetCookEmail] : []);

    return cookEmails.length > 0;
  });
};
// 用途：取得通知建立日期 YYYY-MM-DD
const getSpecialNoticeCreatedDate = (notice) => {
  const value = notice?.createdAt;

  if (!value) return '';

  // 如果 createdAt 是 Date
  if (value instanceof Date) {
    return formatDateToString(value);
  }

  // 如果 createdAt 是字串
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return formatDateToString(parsed);
  }

  return '';
};

// 用途：判斷目前登入者是否符合接收特別通知 popup 的身份
const canCurrentUserReceiveSpecialNoticePopup = (noticeDate) => {
  const currentEmail = String(email || '').trim().toLowerCase();

  const isCookUser =
    userRole === 'cook' ||
    (
      Array.isArray(groupMembers) &&
      groupMembers.some(member =>
        String(member.email || '').trim().toLowerCase() === currentEmail &&
        member.userRole === 'cook'
      )
    );

  const isCookForThatDate = isCurrentUserCookForMealOnDate(noticeDate);

  const noSpecificCookReceiver =
    !hasAnyCookInCurrentGroup &&
    !hasAnyMealCookOnDate(noticeDate);

  return (
    isCookUser ||
    isCookForThatDate ||
    noSpecificCookReceiver
  );
};

// 用途：第一次傳出後，需要 popup 的特別通知
const immediateSpecialNoticeNotifications = useMemo(() => {
  const today = formatDateToString(CURRENT_DATE);
  const currentEmail = String(email || '').trim().toLowerCase();

  const safeActiveNotifications = Array.isArray(activeSpecialNotifications)
    ? activeSpecialNotifications
    : [];

  return safeActiveNotifications.filter(item => {
    if (!item) return false;

    const noticeDate = normalizeDateString(item.date || '');

    // 過去通知不做第一次 popup
    if (!noticeDate || noticeDate < today) {
      return false;
    }

    const senderEmail = String(item.senderEmail || '').trim().toLowerCase();

    // 自己發出的通知不用通知自己
    if (senderEmail && senderEmail === currentEmail) {
      return false;
    }

    const groupMemberEmails = Array.isArray(item.groupMemberEmails)
      ? item.groupMemberEmails.map(e => String(e || '').trim().toLowerCase())
      : [];

    const isGroupMember =
      currentEmail && groupMemberEmails.includes(currentEmail);

    if (!isGroupMember) {
      return false;
    }

    const readByEmails = Array.isArray(item.immediateReadByEmails)
      ? item.immediateReadByEmails.map(e => String(e || '').trim().toLowerCase())
      : [];

    const alreadyRead =
      currentEmail && readByEmails.includes(currentEmail);

    if (alreadyRead) {
      return false;
    }

    return canCurrentUserReceiveSpecialNoticePopup(noticeDate);
  });
}, [
  activeSpecialNotifications,
  email,
  userRole,
  groupMembers,
  uniqueRequests,
  hasAnyCookInCurrentGroup
]);
// 用途：overview 下方列表，只顯示今日及未來的 active 通知
const sortedUpcomingSpecialNotifications = useMemo(() => {
  const today = formatDateToString(CURRENT_DATE);

  const safeActiveNotifications = Array.isArray(activeSpecialNotifications)
    ? activeSpecialNotifications
    : [];

  return [...safeActiveNotifications]
    .filter(item => {
      if (!item) return false;

      const date = normalizeDateString(item.date || '');

      return date && date >= today;
    })
    .sort((a, b) => {
      const dateA = normalizeDateString(a.date || '');
      const dateB = normalizeDateString(b.date || '');

      if (dateA !== dateB) {
        return dateA.localeCompare(dateB);
      }

      const createdA = new Date(a.createdAt || '').getTime();
      const createdB = new Date(b.createdAt || '').getTime();

      const safeA = Number.isNaN(createdA) ? 0 : createdA;
      const safeB = Number.isNaN(createdB) ? 0 : createdB;

      return safeB - safeA;
    });
}, [activeSpecialNotifications]);

// 用途：今日及未來特別通知，按同一人同一日合併顯示
const sortedUpcomingSpecialNotificationGroups = useMemo(() => {
  const merged = mergeSpecialNotificationsByPersonDate(
    sortedUpcomingSpecialNotifications
  );

  return merged.sort((a, b) => {
    const dateA = normalizeDateString(a.date || '');
    const dateB = normalizeDateString(b.date || '');

    if (dateA !== dateB) {
      return dateA.localeCompare(dateB);
    }

    const senderA = String(a.senderNickname || a.senderEmail || '');
    const senderB = String(b.senderNickname || b.senderEmail || '');

    return senderA.localeCompare(senderB);
  });
}, [sortedUpcomingSpecialNotifications]);
// 用途：取得某日所有 active 特別通知
const getSpecialNotificationsByDate = (dateStr) => {
  const normalized = normalizeDateString(dateStr);

  return (activeSpecialNotifications || []).filter(item =>
    normalizeDateString(item.date || '') === normalized
  );
};
// 用途：通知生效日前一天需要 popup 的特別通知
// 注意：今天 / 明天的通知只做第一次傳出 popup，不做第二次前一天提醒
const specialNoticeReminders = useMemo(() => {
  const today = formatDateToString(CURRENT_DATE);
  const tomorrow = getTomorrowDateString();
  const currentEmail = String(email || '').trim().toLowerCase();

  const safeActiveNotifications = Array.isArray(activeSpecialNotifications)
    ? activeSpecialNotifications
    : [];

  return safeActiveNotifications.filter(item => {
    if (!item) return false;

    const noticeDate = normalizeDateString(item.date || '');

    // 只處理明日生效的通知
    if (noticeDate !== tomorrow) {
      return false;
    }

    const createdDate = getSpecialNoticeCreatedDate(item);

    // 如果是今天才傳出的明日通知，已經做第一次 popup，不再做第二次
    if (createdDate === today) {
      return false;
    }

    const senderEmail = String(item.senderEmail || '').trim().toLowerCase();

    // 自己發出的通知不用通知自己
    if (senderEmail && senderEmail === currentEmail) {
      return false;
    }

    const readByEmails = Array.isArray(item.reminderReadByEmails)
      ? item.reminderReadByEmails.map(e => String(e || '').trim().toLowerCase())
      : [];

    const alreadyRead =
      currentEmail && readByEmails.includes(currentEmail);

    if (alreadyRead) {
      return false;
    }

    const groupMemberEmails = Array.isArray(item.groupMemberEmails)
      ? item.groupMemberEmails.map(e => String(e || '').trim().toLowerCase())
      : [];

    const isGroupMember =
      currentEmail && groupMemberEmails.includes(currentEmail);

    if (!isGroupMember) {
      return false;
    }

    return canCurrentUserReceiveSpecialNoticePopup(noticeDate);
  });
}, [
  activeSpecialNotifications,
  email,
  userRole,
  uniqueRequests,
  groupMembers,
  hasAnyCookInCurrentGroup
]);


// 用途：所有需要 popup 的特別通知，包括第一次傳出 + 前一天提醒
const specialNoticePopupItems = useMemo(() => {
  return [
    ...(Array.isArray(immediateSpecialNoticeNotifications)
      ? immediateSpecialNoticeNotifications.map(item => ({
          ...item,
          popupType: 'immediate'
        }))
      : []),

    ...(Array.isArray(specialNoticeReminders)
      ? specialNoticeReminders.map(item => ({
          ...item,
          popupType: 'reminder'
        }))
      : [])
  ];
}, [immediateSpecialNoticeNotifications, specialNoticeReminders]);

const specialNoticePopupCount = Array.isArray(specialNoticePopupItems)
  ? specialNoticePopupItems.length
  : 0;

// 用途：如果有需要 popup 的特別通知，自動 popup
useEffect(() => {
  if (appStage === 'main' && specialNoticePopupCount > 0) {
    setSpecialNoticeReminderModalVisible(true);
  }

  if (specialNoticePopupCount === 0) {
    setSpecialNoticeReminderModalVisible(false);
  }
}, [appStage, specialNoticePopupCount]);


// 用途：關閉單一大廚通知
const dismissOneCookMessage = async (req) => {
  const key = getCookMessageKey(req);

  setDismissedCookMessageKeys(prev =>
    Array.from(new Set([...prev, key]))
  );

  await markCookMessageAsReadInFirebase(req);
  await loadRequestsFromFirebase();
};

// 用途：關閉目前所有大廚通知
const dismissAllCookMessages = async () => {
  const keys = (senderNotifications || []).map(getCookMessageKey);

  setDismissedCookMessageKeys(prev =>
    Array.from(new Set([...prev, ...keys]))
  );

  for (const req of senderNotifications || []) {
    await markCookMessageAsReadInFirebase(req);
  }

  await loadRequestsFromFirebase();

  setSenderNotificationModalVisible(false);
};

const toggleSpecialNoticeType = (typeKey) => {
  setSpecialNoticeTypes(prev => {
    const safePrev = Array.isArray(prev) ? prev : [];

    if (safePrev.includes(typeKey)) {
      return safePrev.filter(item => item !== typeKey);
    }

    return [...safePrev, typeKey];
  });

  // 如果取消 other，就清空其他文字
  if (typeKey === 'other' && specialNoticeTypes.includes('other')) {
    setSpecialNoticeOtherText('');
  }
};

// 用途：把單一特別通知 popup 標記為已讀
const markSpecialNoticePopupAsRead = async (notice) => {
  try {
    if (!email || !notice?.id) return;

    const currentEmail = String(email || '').trim().toLowerCase();

    const oldImmediateReadByEmails = Array.isArray(notice.immediateReadByEmails)
      ? notice.immediateReadByEmails.map(e => String(e || '').trim().toLowerCase())
      : [];

    const oldReminderReadByEmails = Array.isArray(notice.reminderReadByEmails)
      ? notice.reminderReadByEmails.map(e => String(e || '').trim().toLowerCase())
      : [];

    const nextImmediateReadByEmails =
      notice.popupType === 'immediate'
        ? Array.from(new Set([...oldImmediateReadByEmails, currentEmail].filter(Boolean)))
        : oldImmediateReadByEmails;

    const nextReminderReadByEmails =
      notice.popupType === 'reminder'
        ? Array.from(new Set([...oldReminderReadByEmails, currentEmail].filter(Boolean)))
        : oldReminderReadByEmails;

    await db.collection('specialNotifications').update(notice.id, {
      noticeTypes: getNoticeTypesFromItem(notice),
      noticeType: notice.noticeType || getNoticeTypesFromItem(notice)[0] || '',
      otherText: notice.otherText || '',

      date: notice.date || '',

      groupCode: notice.groupCode || groupInviteCode || '',
      familyGroupName: notice.familyGroupName || familyGroupName || '',

      groupMemberEmails:
        Array.isArray(notice.groupMemberEmails) && notice.groupMemberEmails.length > 0
          ? notice.groupMemberEmails
          : getCurrentGroupMemberEmails(),

      groupAdminEmails:
        Array.isArray(notice.groupAdminEmails)
          ? notice.groupAdminEmails
          : [],

      senderEmail: notice.senderEmail || '',
      senderNickname: notice.senderNickname || '',

      status: notice.status || 'active',

      immediateReadByEmails: nextImmediateReadByEmails,
      reminderReadByEmails: nextReminderReadByEmails,

      createdAt: notice.createdAt || new Date(),
      updatedAt: new Date(),

      canceledAt: notice.canceledAt || '',
      canceledByEmail: notice.canceledByEmail || '',
      canceledByNickname: notice.canceledByNickname || ''
    });
  } catch (error) {
    console.log('markSpecialNoticePopupAsRead error:', error);
    showMessage('標記特別通知已讀失敗', error.message || String(error));
  }
};


const dismissAllSpecialNoticePopups = async () => {
  try {
    for (const notice of specialNoticePopupItems || []) {
      await markSpecialNoticePopupAsRead(notice);
    }

    await loadSpecialNotificationsFromFirebase();

    setSpecialNoticeReminderModalVisible(false);
  } catch (error) {
    console.log('dismissAllSpecialNoticePopups error:', error);
    showMessage('關閉特別通知失敗', error.message || String(error));
  }
};
// 用途：點菜 Modal 的大廚下拉選單，永遠顯示所有群組成員
const cookOptions = useMemo(() => {
  return Array.isArray(groupMembers) ? groupMembers : [];
}, [groupMembers]);

// 用途：打開點菜 Modal，預設選第一位 cook；但下拉選單仍然可選所有成員
// 餐次 / 是否加入購物清單會沿用上一次選項，不再硬性預設
const openRequestModal = (dish, targetDateStr = null) => {
  setSelectedDish(dish);

  const allMembers = Array.isArray(groupMembers) ? groupMembers : [];

  const defaultCook =
    allMembers.find(member => member.userRole === 'cook') ||
    allMembers[0];

  if (defaultCook) {
    setTargetCook(defaultCook.name || '');
    setTargetCookEmail(defaultCook.email || '');
  } else {
    setTargetCook('');
    setTargetCookEmail('');
  }

  // 沿用上一次餐次；如果從未選過，就保持空白，要求用戶選
  setSelectedMeal(lastSelectedMeal || '');

  // 沿用上一次是否加入購物清單
  // true = 勾選；false / null = 不勾
  setAutoAddToList(lastAutoAddToList === true);

  setCustomDateInput(targetDateStr || formatDateToString(CURRENT_DATE));
  setCookDropdownOpen(false);
  setMealDropdownOpen(false);
  setRequestModalVisible(true);
};

const openFruitRequestModal = (fruit, targetDateStr = null) => {
  setSelectedFruit(fruit);

  const allMembers = Array.isArray(groupMembers) ? groupMembers : [];

  const lastTarget = allMembers.find(member =>
    member.email && member.email === lastFruitTargetEmail
  );

  const defaultTarget =
    lastTarget ||
    allMembers.find(member => member.email === email) ||
    allMembers[0];

  if (defaultTarget) {
    setFruitTargetName(defaultTarget.name || '');
    setFruitTargetEmail(defaultTarget.email || '');
  } else {
    setFruitTargetName('');
    setFruitTargetEmail('');
  }

setFruitAutoAddToList(lastAutoAddToList === true);
setFruitTargetDropdownOpen(false);
setFruitRequestModalVisible(true);
};

// 抽菜
// 用途：只從目前搜尋 / 標籤篩選後的菜式中抽
const handleDraw = () => {
  const drawPool = Array.isArray(displayedDishes) ? displayedDishes : [];

  if (drawPool.length === 0) {
    return showMessage(
      selectedTags.length > 0 || searchQuery.trim()
        ? '目前沒有符合的菜餚！'
        : '目前沒有可用的菜餚！'
    );
  }

  openRequestModal(
    drawPool[Math.floor(Math.random() * drawPool.length)]
  );
};

// 用途：取得某個標籤在目前群組菜式中出現次數
// 注意：只計 approved 公開菜式 + 本群組 private 菜式，不計 pending，避免不同用戶看到不同排序
const getTagUsageCount = (tagName) => {
  const safeDishes = Array.isArray(dishes) ? dishes : [];

  return safeDishes.filter(dish => {
    const status = String(
      dish.publishStatus ?? (dish.isPublic ? 'approved' : 'private')
    ).trim().toLowerCase();

    const dishTags = getDishVisibleTags(dish);

    const isVisibleForGroup =
      status === 'approved' ||
      (
        status === 'private' &&
        dish.groupCode === groupInviteCode
      );

    return isVisibleForGroup && dishTags.includes(tagName);
  }).length;
};

// 用途：取得某個分類底下所有標籤
const getAllTagsInCategory = (category) => {
  if (!category) return [];

  if (category.isNested) {
    let result = [];

    Object.keys(category.subCategories || {}).forEach(subKey => {
      const subCat = category.subCategories[subKey];
      result = [...result, ...(subCat.tags || [])];
    });

    return result;
  }

  return category.tags || [];
};
// 用途：穩定排序子分類
// 1. 初始時按 INITIAL_TAG_CATEGORIES 的原本順序
// 2. 有使用數據後，使用率高的子分類排前
// 3. 使用率相同時，回到初始順序
// 4. 自訂子分類排在系統子分類後面；自訂之間按使用率，再按 key 固定
const getSortedSubCategoryKeys = (catKey) => {
  const category = dynamicCategories[catKey];
  const subKeys = Object.keys(category?.subCategories || {});

  const initialSubCategories = INITIAL_TAG_CATEGORIES[catKey]?.subCategories || {};
  const initialSubKeys = Object.keys(initialSubCategories);

  return [...subKeys].sort((a, b) => {
    const aInitialIndex = initialSubKeys.indexOf(a);
    const bInitialIndex = initialSubKeys.indexOf(b);

    const aIsInitial = aInitialIndex !== -1;
    const bIsInitial = bInitialIndex !== -1;

    const aSubCat = category.subCategories?.[a];
    const bSubCat = category.subCategories?.[b];

    const aUsage = (aSubCat?.tags || []).reduce(
      (total, tag) => total + getTagUsageCount(tag),
      0
    );

    const bUsage = (bSubCat?.tags || []).reduce(
      (total, tag) => total + getTagUsageCount(tag),
      0
    );

    // 兩個都是系統子分類
    if (aIsInitial && bIsInitial) {
      // 有使用差異時，使用率高排前
      if (bUsage !== aUsage) {
        return bUsage - aUsage;
      }

      // 沒有使用差異 / 初始狀態，回到初始順序
      return aInitialIndex - bInitialIndex;
    }

    // 系統子分類排在自訂子分類前
    if (aIsInitial && !bIsInitial) return -1;
    if (!aIsInitial && bIsInitial) return 1;

    // 兩個都是自訂子分類：使用率高排前
    if (bUsage !== aUsage) {
      return bUsage - aUsage;
    }

    // 使用率相同，用 key 固定排序，避免每次跳
    return String(a).localeCompare(String(b));
  });
};
// 用途：計算分類使用次數，等於該分類底下所有標籤在菜式中出現次數總和
const getCategoryUsageCount = (category) => {
  const tags = getAllTagsInCategory(category);

  return tags.reduce((total, tag) => {
    return total + getTagUsageCount(tag);
  }, 0);
};

// 用途：判斷是否系統預設分類
const isInitialCategoryKey = (catKey) => {
  return !!INITIAL_TAG_CATEGORIES[catKey];
};

// 用途：取得系統預設分類的固定順序
const getInitialCategoryIndex = (catKey) => {
  return Object.keys(INITIAL_TAG_CATEGORIES).indexOf(catKey);
};

// 用途：穩定排序分類
// 1. 系統預設分類永遠固定在前，按 INITIAL_TAG_CATEGORIES 順序
// 2. 自訂分類排在後面
// 3. 自訂分類按使用次數由多至少
// 4. 使用次數相同時，用 key 排序，確保每個人看到一樣
const getSortedCategoryKeys = () => {
  const keys = Object.keys(dynamicCategories || {});

  return keys.sort((a, b) => {
    const aIsInitial = isInitialCategoryKey(a);
    const bIsInitial = isInitialCategoryKey(b);

    if (aIsInitial && bIsInitial) {
      return getInitialCategoryIndex(a) - getInitialCategoryIndex(b);
    }

    if (aIsInitial && !bIsInitial) return -1;
    if (!aIsInitial && bIsInitial) return 1;

    const aUsage = getCategoryUsageCount(dynamicCategories[a]);
    const bUsage = getCategoryUsageCount(dynamicCategories[b]);

    if (bUsage !== aUsage) {
      return bUsage - aUsage;
    }

    return String(a).localeCompare(String(b));
  });
};

// 用途：判斷某標籤是否系統預設標籤
const isInitialTag = (tagName) => {
  const initialTagSet = getInitialTagSet();
  return initialTagSet.has(tagName);
};

// 用途：取得某分類內的系統預設標籤順序
const getInitialTagIndexInCategory = (catKey, subKey, tagName) => {
  const initialCat = INITIAL_TAG_CATEGORIES[catKey];

  if (!initialCat) return -1;

  if (initialCat.isNested) {
    const initialSubCat = initialCat.subCategories?.[subKey];
    const tags = initialSubCat?.tags || [];
    return tags.indexOf(tagName);
  }

  const tags = initialCat.tags || [];
  return tags.indexOf(tagName);
};

// 用途：穩定排序標籤
// 1. 系統預設標籤固定在前，按 INITIAL_TAG_CATEGORIES 原本順序
// 2. 自訂標籤排在後面
// 3. 自訂標籤按使用次數由多至少
// 4. 使用次數相同時，用文字排序，確保每個人看到一樣
const getSortedTags = (tags, catKey, subKey = null) => {
  const safeTags = Array.isArray(tags) ? tags : [];

  return [...safeTags].sort((a, b) => {
    const aIsInitial = isInitialTag(a);
    const bIsInitial = isInitialTag(b);

    if (aIsInitial && bIsInitial) {
      const aIndex = getInitialTagIndexInCategory(catKey, subKey, a);
      const bIndex = getInitialTagIndexInCategory(catKey, subKey, b);

      if (aIndex !== -1 && bIndex !== -1) {
        return aIndex - bIndex;
      }

      return String(a).localeCompare(String(b));
    }

    if (aIsInitial && !bIsInitial) return -1;
    if (!aIsInitial && bIsInitial) return 1;

    const aUsage = getTagUsageCount(a);
    const bUsage = getTagUsageCount(b);

    if (bUsage !== aUsage) {
      return bUsage - aUsage;
    }

    return String(a).localeCompare(String(b));
  });
};

// 用途：從 Firebase 讀取目前群組相關的點菜要求
const loadRequestsFromFirebase = async () => {
  try {
    if (!groupInviteCode || !email) {
      setRequests([]);
      return;
    }

    const allRequests = await db
      .collection('requests')
      .whereArrayContains('groupMemberEmails', email);

    const safeRequests = Array.isArray(allRequests) ? allRequests : [];


// 用途：載入目前群組所有點菜要求，包括 rejected / completed
// completed 要保留給月曆顯示，但不顯示在下方排餐動態
const groupRequests = safeRequests.filter(req =>
  req.groupCode === groupInviteCode
);

    setRequests(groupRequests);
  } catch (error) {
    console.log('loadRequestsFromFirebase error:', error);
    showMessage('載入點菜要求失敗', error.message || String(error));
  }
};
// 用途：從 Firebase 讀取目前群組的特別通知
const loadSpecialNotificationsFromFirebase = async () => {
  try {
    if (!groupInviteCode || !email) {
      setSpecialNotifications([]);
      return;
    }

    const allNotifications = await db
      .collection('specialNotifications')
      .whereArrayContains('groupMemberEmails', email);

    const safeNotifications = Array.isArray(allNotifications)
      ? allNotifications
      : [];

    const groupNotifications = safeNotifications.filter(item =>
      item && item.groupCode === groupInviteCode
    );

    setSpecialNotifications(groupNotifications);
  } catch (error) {
    console.log('loadSpecialNotificationsFromFirebase error:', error);
    showMessage('載入特別通知失敗', error.message || String(error));
  }
};
// 用途：登入、切換群組、進入主畫面後，自動載入 Firebase 點菜要求
useEffect(() => {
  if (appStage === 'main') {
    loadRequestsFromFirebase();
  }
}, [appStage, groupInviteCode, email]);
// 用途：登入、切換群組、進入主畫面後，自動載入特別通知
useEffect(() => {
  if (appStage === 'main') {
    loadSpecialNotificationsFromFirebase();
  }
}, [appStage, groupInviteCode, email]);
//
const isActiveRequestStatus = (status) => {
  return ['pending', 'approved'].includes(status);
};


const sendRequest = async () => {
  try {
    if (!selectedDish) {
      return showMessage('已選擇的菜式不存在。');
    }

    if (!customDateInput) {
      return showMessage( '請輸入日期');
    }

    // 餐次不再硬性預設，用戶必須選擇
    if (!selectedMeal) {
      return showMessage( '請選擇餐次。');
    }

 
    if (!targetCook || !targetCookEmail) {
      return showMessage( '請選擇大廚。');
    }

    if (!groupInviteCode) {
      return showMessage( '你目前未加入任何群組，不能送出點菜要求。');
    }

    const normalizedDate = normalizeDateString(customDateInput);

    if (isPastDate(normalizedDate)) {
      return showMessage('不能選擇過去的日子，請望向未來。');
    }

    const isRequestToSelf =
      targetCookEmail &&
      email &&
      targetCookEmail === email;

    // 用途：防止同一個人向同一個 cook 重複送出同一菜式 / 同一日 / 同一餐次
    // 注意：這裡仍然包含 senderEmail 和 targetCookEmail
    // 因為 A、B、C 不同人都可以點同一道菜，只是畫面會合併顯示
    const duplicateRequest = (requests || []).find(req =>
      req.groupCode === groupInviteCode &&
      (req.dishId || req.dishName) === (selectedDish.id || selectedDish.name) &&
      req.date === normalizedDate &&
      req.meal === selectedMeal &&
      req.senderEmail === email &&
      req.targetCookEmail === targetCookEmail &&
      req.status !== 'rejected'
    );

    if (duplicateRequest) {
      return showMessage(
         '你已經送過相同的點菜要求囉。'
      );
    }

    // 用途：建立這個 request 可讀取的群組成員 email 名單
    const groupMemberEmails = (groupMembers || [])
      .map(member => member.email)
      .filter(Boolean);

    if (email && !groupMemberEmails.includes(email)) {
      groupMemberEmails.push(email);
    }

    if (targetCookEmail && !groupMemberEmails.includes(targetCookEmail)) {
      groupMemberEmails.push(targetCookEmail);
    }

    const requestData = {
      dishId: selectedDish.id || '',
      dishName: selectedDish.name || '',
      ingredients: selectedDish.ingredients || '',

      groupCode: groupInviteCode || '',
      familyGroupName: familyGroupName || '',

      // 權限相關欄位
      groupMemberEmails: groupMemberEmails,
      groupAdminEmails: Array.isArray(groupAdminEmails) ? groupAdminEmails : [],

      // 發起人
      senderEmail: email || '',
      senderNickname: nickname || '',

      // 指定大廚
      targetCookEmail: targetCookEmail || '',
      targetCookName: targetCook || '',

      date: normalizedDate,
      meal: selectedMeal || '',

      // 自己送給自己：直接 approved
      // 送給其他人：pending，等對方同意
      status: isRequestToSelf ? 'approved' : 'pending',

      // 發起人選擇是否加入自己的購物清單
      autoAddToList: autoAddToList === true,

      // 大廚審核相關欄位，先預留
     cookApprovedAddToList: false,
cookMessage: '',
rejectionReason: '',
rescheduleReason: '',

// 用途：記錄哪些發起人已讀過大廚通知
cookMessageReadByEmails: [],

      createdAt: new Date(),
      updatedAt: new Date(),

      approvedAt: isRequestToSelf ? new Date() : '',
      approvedByEmail: isRequestToSelf ? email : '',
      approvedByNickname: isRequestToSelf ? nickname : '',

      rejectedAt: '',
      rejectedByEmail: '',
      rejectedByNickname: '',

      rescheduledAt: '',
      rescheduledByEmail: '',
      rescheduledByNickname: ''
    };


    await db.collection('requests').add(requestData);

    // 記住今次選項，下次打開「提出想吃」時沿用
const nextMeal = selectedMeal;
const nextAutoAdd = autoAddToList === true;

setLastSelectedMeal(nextMeal);
setLastAutoAddToList(nextAutoAdd);

await saveLastSelectionsToDevice({
  meal: nextMeal,
  autoAdd: nextAutoAdd,
  approveAdd: lastApproveAddToList
});


    // 發起人自己選擇加入購物清單
   if (autoAddToList === true) {
  addToShoppingList(selectedDish.ingredients);
}

    await loadRequestsFromFirebase();

    setRequestModalVisible(false);
  } catch (error) {
    console.log('sendRequest error:', error);
    showMessage('送出點菜要求失敗', error.message || String(error));
  }
};
//水果
const sendFruitRequest = async () => {
  try {
    if (!selectedFruit) {
      return showMessage('已選擇的水果不存在。');
    }

   
    if (!fruitTargetName || !fruitTargetEmail) {
      return showMessage('請選擇通知對象。');
    }

    if (!groupInviteCode) {
      return showMessage('你目前未加入任何群組，不能送出水果要求。');
    }


    const isRequestToSelf =
      fruitTargetEmail &&
      email &&
      fruitTargetEmail === email;

const duplicateRequest = (requests || []).find(req =>
  req.requestType === 'fruit' &&
  req.groupCode === groupInviteCode &&
  (req.fruitId || req.fruitName) === (selectedFruit.id || selectedFruit.name) &&
  req.senderEmail === email &&
  (req.targetPersonEmail || req.targetCookEmail) === fruitTargetEmail &&
  isActiveRequestStatus(req.status)
);


    if (duplicateRequest) {
      return showMessage('你已經送過相同的水果要求囉。');
    }

    const groupMemberEmails = (groupMembers || [])
      .map(member => member.email)
      .filter(Boolean);

    if (email && !groupMemberEmails.includes(email)) {
      groupMemberEmails.push(email);
    }

    if (fruitTargetEmail && !groupMemberEmails.includes(fruitTargetEmail)) {
      groupMemberEmails.push(fruitTargetEmail);
    }

    const requestData = {
      requestType: 'fruit',

      fruitId: selectedFruit.id || '',
      fruitName: selectedFruit.name || '',

      // 保留這兩個欄位，方便舊 UI fallback
      dishId: '',
      dishName: selectedFruit.name || '',
      ingredients: selectedFruit.name || '',

      groupCode: groupInviteCode || '',
      familyGroupName: familyGroupName || '',

      groupMemberEmails: groupMemberEmails,
      groupAdminEmails: Array.isArray(groupAdminEmails) ? groupAdminEmails : [],

      senderEmail: email || '',
      senderNickname: nickname || '',

      // 水果用通知對象
      targetPersonEmail: fruitTargetEmail || '',
      targetPersonName: fruitTargetName || '',

      // 同時保留舊欄位，減少現有 request 顯示爆掉
      targetCookEmail: fruitTargetEmail || '',
      targetCookName: fruitTargetName || '',

date: '',
meal: '',

      status: isRequestToSelf ? 'approved' : 'pending',

      autoAddToList: fruitAutoAddToList === true,
      cookApprovedAddToList: false,

      cookMessage: '',
      rejectionReason: '',
      rescheduleReason: '',
      cookMessageReadByEmails: [],

      createdAt: new Date(),
      updatedAt: new Date(),

      approvedAt: isRequestToSelf ? new Date() : '',
      approvedByEmail: isRequestToSelf ? email : '',
      approvedByNickname: isRequestToSelf ? nickname : '',

      rejectedAt: '',
      rejectedByEmail: '',
      rejectedByNickname: '',

      rescheduledAt: '',
      rescheduledByEmail: '',
      rescheduledByNickname: '',

      completedAt: '',
      completedByEmail: '',
      completedByNickname: ''
    };

    await db.collection('requests').add(requestData);

 const nextAutoAdd = fruitAutoAddToList === true;

setLastAutoAddToList(nextAutoAdd);

await saveLastSelectionsToDevice({
  meal: lastSelectedMeal,
  autoAdd: nextAutoAdd,
  approveAdd: lastApproveAddToList
});

    setLastFruitTargetEmail(fruitTargetEmail);
    setLastFruitTargetName(fruitTargetName);

    await saveLastFruitSelectionToDevice({
      targetEmail: fruitTargetEmail,
      targetName: fruitTargetName
    });

    if (fruitAutoAddToList === true) {
      addToShoppingList(selectedFruit.name);
    }

    await loadRequestsFromFirebase();

    setFruitRequestModalVisible(false);
  } catch (error) {
    console.log('sendFruitRequest error:', error);
    showMessage('送出水果要求失敗', error.message || String(error));
  }
};
// 用途：送出特別通知到群組
const sendSpecialNotification = async () => {
  try {
    if (isSpecialNoticeSubmitting) return;

    if (!email) {
      return showMessage('請先登入。');
    }

    if (!groupInviteCode) {
      return showMessage('你目前未加入任何群組，不能送出特別通知。');
    }

    if (!specialNoticeDateInput) {
      return showMessage('請輸入日期。');
    }

    const normalizedDate = normalizeDateString(specialNoticeDateInput);

    if (isPastDate(normalizedDate)) {
      return showMessage('不能選擇過去的日子。');
    }

    const selectedTypes = Array.isArray(specialNoticeTypes)
  ? specialNoticeTypes
  : [];

if (selectedTypes.length === 0) {
  return showMessage('請至少選擇一個通知類型。');
}

    const finalOtherText = specialNoticeOtherText.trim();

    if (selectedTypes.includes('other') && !finalOtherText) {
  return showMessage('請輸入其他通知內容。');
}

    const duplicateNotice = (specialNotifications || []).find(item => {
  const existingTypes = getNoticeTypesFromItem(item);

  const sameTypes =
    existingTypes.length === selectedTypes.length &&
    existingTypes.every(type => selectedTypes.includes(type));

  return (
    item.status !== 'canceled' &&
    item.groupCode === groupInviteCode &&
    normalizeDateString(item.date || '') === normalizedDate &&
    item.senderEmail === email &&
    sameTypes &&
    String(item.otherText || '').trim() === finalOtherText
  );
});

    if (duplicateNotice) {
      return showMessage('你已經送過相同的特別通知。');
    }

    let groupMemberEmails = (groupMembers || [])
  .map(member => member.email)
  .filter(Boolean);

// 如果 groupMembers 尚未載入完整，就從 familyGroups 補 memberEmails
if (groupMemberEmails.length === 0 && groupInviteCode) {
  const groups = await db.collection('familyGroups').getAll();
  const currentGroup = (Array.isArray(groups) ? groups : []).find(
    group => group.inviteCode === groupInviteCode
  );

  if (currentGroup && Array.isArray(currentGroup.memberEmails)) {
    groupMemberEmails = currentGroup.memberEmails.filter(Boolean);
  }
}

if (email && !groupMemberEmails.includes(email)) {
  groupMemberEmails.push(email);
}

groupMemberEmails = Array.from(
  new Set(
    groupMemberEmails
      .map(e => String(e || '').trim().toLowerCase())
      .filter(Boolean)
  )
);

const currentEmail = String(email || '').trim().toLowerCase();

const noticeData = {
  noticeTypes: selectedTypes,

  // 保留舊欄位，方便舊 UI fallback；用第一個類型
  noticeType: selectedTypes[0] || '',

  otherText: selectedTypes.includes('other') ? finalOtherText : '',

  date: normalizedDate,

  groupCode: groupInviteCode || '',
  familyGroupName: familyGroupName || '',

  groupMemberEmails,
  groupAdminEmails: Array.isArray(groupAdminEmails) ? groupAdminEmails : [],

  senderEmail: currentEmail,
  senderNickname: nickname || '',

  status: 'active',

  // 第一次傳出通知：自己不用收到，所以先標記自己已讀
  immediateReadByEmails: currentEmail ? [currentEmail] : [],

  // 前一天提醒：自己也不用收到，所以先標記自己已讀
  reminderReadByEmails: currentEmail ? [currentEmail] : [],

  createdAt: new Date(),
  updatedAt: new Date(),

  canceledAt: '',
  canceledByEmail: '',
  canceledByNickname: ''
};

    setIsSpecialNoticeSubmitting(true);

    await db.collection('specialNotifications').add(noticeData);

await loadSpecialNotificationsFromFirebase();

setSpecialNoticeDateInput(formatDateToString(CURRENT_DATE));
setSpecialNoticeTypes([]);
setSpecialNoticeOtherText('');
setIsSpecialNoticeSubmitting(false);
setSpecialNoticeSubPage('overview');

  } catch (error) {
    console.log('sendSpecialNotification error:', error);
    setIsSpecialNoticeSubmitting(false);
    showMessage('送出特別通知失敗', error.message || String(error));
  }
};

// 用途：取消自己的特別通知
// 注意：Admin 不可以取消其他人的通知
const cancelSpecialNotification = async (notice) => {
  try {
    if (!notice?.id) {
      return showMessage('找不到此特別通知。');
    }

    if (notice.senderEmail !== email) {
      return showMessage('只可以取消自己發出的特別通知。');
    }

    await db.collection('specialNotifications').update(notice.id, {
      noticeTypes: getNoticeTypesFromItem(notice),
noticeType: notice.noticeType || getNoticeTypesFromItem(notice)[0] || '',
otherText: notice.otherText || '',

      date: notice.date || '',

      groupCode: notice.groupCode || groupInviteCode || '',
      familyGroupName: notice.familyGroupName || familyGroupName || '',

      groupMemberEmails:
        Array.isArray(notice.groupMemberEmails) && notice.groupMemberEmails.length > 0
          ? notice.groupMemberEmails
          : getCurrentGroupMemberEmails(),

      groupAdminEmails:
        Array.isArray(notice.groupAdminEmails)
          ? notice.groupAdminEmails
          : [],

      senderEmail: notice.senderEmail || '',
      senderNickname: notice.senderNickname || '',

      status: 'canceled',

immediateReadByEmails: Array.isArray(notice.immediateReadByEmails)
  ? notice.immediateReadByEmails
  : [],

reminderReadByEmails: Array.isArray(notice.reminderReadByEmails)
  ? notice.reminderReadByEmails
  : [],


      createdAt: notice.createdAt || new Date(),
      updatedAt: new Date(),

      canceledAt: new Date(),
      canceledByEmail: email || '',
      canceledByNickname: nickname || ''
    });

    await loadSpecialNotificationsFromFirebase();


  } catch (error) {
    console.log('cancelSpecialNotification error:', error);
    showMessage('取消特別通知失敗', error.message || String(error));
  }
};

// 用途：取消同一人同一日的合併特別通知
const cancelSpecialNotificationGroup = async (noticeGroup) => {
  try {
    const originalNotices = Array.isArray(noticeGroup?.mergedOriginalNotices)
      ? noticeGroup.mergedOriginalNotices
      : [noticeGroup];

    const targetNotices = originalNotices.filter(item =>
      item &&
      item.id &&
      item.senderEmail === email
    );

    if (targetNotices.length === 0) {
      return showMessage('只可以取消自己發出的特別通知。');
    }

    for (const notice of targetNotices) {
      await cancelSpecialNotification(notice);
    }

    await loadSpecialNotificationsFromFirebase();
  } catch (error) {
    console.log('cancelSpecialNotificationGroup error:', error);
    showMessage('取消特別通知失敗', error.message || String(error));
  }
};
// 用途：cook 同意點菜要求；如果畫面合併了多個相同 request，就一次全部同意
// 同意時可選擇是否把材料加入購物清單
// 注意：approveAddToList === true 才加入；false / null 都當作不加入
const handleApproveRequest = async (idOrIds) => {
  try {
    const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];

    const targetRequests = (requests || []).filter(req =>
      ids.includes(req.id)
    );

    if (targetRequests.length === 0) {
      return showMessage('找不到這個點菜要求。');
    }

    for (const targetReq of targetRequests) {
      await db.collection('requests').update(targetReq.id, {
        dishId: targetReq.dishId || '',
        dishName: targetReq.dishName || '',
        ingredients: targetReq.ingredients || '',
requestType: targetReq.requestType || 'dish',
fruitId: targetReq.fruitId || '',
fruitName: targetReq.fruitName || '',
targetPersonEmail: targetReq.targetPersonEmail || '',
targetPersonName: targetReq.targetPersonName || '',
        groupCode: targetReq.groupCode || groupInviteCode || '',
        familyGroupName: targetReq.familyGroupName || familyGroupName || '',

        // 重要：保留權限欄位，避免之後讀取 / 改期 / 同意再被 rules 擋
        groupMemberEmails:
          Array.isArray(targetReq.groupMemberEmails) && targetReq.groupMemberEmails.length > 0
            ? targetReq.groupMemberEmails
            : getCurrentGroupMemberEmails(),

        groupAdminEmails:
          Array.isArray(targetReq.groupAdminEmails) && targetReq.groupAdminEmails.length > 0
            ? targetReq.groupAdminEmails
            : (Array.isArray(groupAdminEmails) ? groupAdminEmails : []),

        senderEmail: targetReq.senderEmail || '',
        senderNickname: targetReq.senderNickname || targetReq.sender || '',

        targetCookEmail: targetReq.targetCookEmail || '',
        targetCookName: targetReq.targetCookName || targetReq.target || '',

        date:
  targetReq.requestType === 'fruit'
    ? ''
    : (targetReq.date || ''),
        meal:
  targetReq.requestType === 'fruit'
    ? ''
    : (targetReq.meal || ''),

        status: 'approved',

        autoAddToList: targetReq.autoAddToList || false,

        // 大廚是否把材料加入自己的購物清單
        // true 才加入；false / null 都當作不加入
        cookApprovedAddToList: approveAddToList === true,

        cookMessage: targetReq.cookMessage || '',
        rejectionReason: '',
        rescheduleReason: targetReq.rescheduleReason || '',

        createdAt: targetReq.createdAt || new Date(),
        updatedAt: new Date(),

        approvedAt: new Date(),
        approvedByEmail: email || '',
        approvedByNickname: nickname || '',

        rejectedAt: '',
        rejectedByEmail: '',
        rejectedByNickname: '',

        rescheduledAt: targetReq.rescheduledAt || '',
        rescheduledByEmail: targetReq.rescheduledByEmail || '',
        rescheduledByNickname: targetReq.rescheduledByNickname || ''
      });
    }

    // 大廚選擇加入購物清單時，只加一次材料，避免合併 request 重複加
    if (approveAddToList === true && targetRequests[0]?.ingredients) {
      addToShoppingList(targetRequests[0].ingredients);
    }

    // 記住大廚今次選項，下次打開審核視窗時沿用
const nextApprove = approveAddToList === true;

setLastApproveAddToList(nextApprove);

await saveLastSelectionsToDevice({
  meal: lastSelectedMeal,
  autoAdd: lastAutoAddToList,
  approveAdd: nextApprove
});

    // 用途：判斷同意後，自己還有沒有其他 pending request 要處理
const remainingIncomingRequests = (incomingRequests || []).filter(req =>
  !ids.includes(req.id)
);

await loadRequestsFromFirebase();

if (remainingIncomingRequests.length === 0) {
  setRequestInboxVisible(false);
} else {
  setRequestInboxVisible(true);
}

  } catch (error) {
    console.log('handleApproveRequest error:', error);
    showMessage('同意點菜要求失敗', error.message || String(error));
  }
};

//fruit
const isRejectTargetFruit = () => {
  if (rejectTargetRequest?.requestType === 'fruit') return true;

  const ids = Array.isArray(rejectTargetRequest?.mergedRequestIds)
    ? rejectTargetRequest.mergedRequestIds
    : [rejectTargetRequest?.id];

  return (requests || []).some(req =>
    ids.includes(req.id) &&
    req.requestType === 'fruit'
  );
};

// 用途：如果目前登入者有 pending 點菜要求，打開 App 後自動彈出處理視窗
// 並沿用大廚上一次「是否加入購物清單」選項
useEffect(() => {
  if (appStage !== 'main') return;
  if (!Array.isArray(incomingRequests)) return;

  // ✅ 有 request → 強制彈
  if (incomingRequests.length > 0) {
    // 第一次 or 有新 request
    if (!hasShownInboxRef.current) {
      hasShownInboxRef.current = true;

      setApproveAddToList(lastApproveAddToList === true);

      // ✅ 強制 reopen（解決你「無反應」問題）
      setRequestInboxVisible(false);

      setTimeout(() => {
        setRequestInboxVisible(true);
        setForceOpenInboxKey(prev => prev + 1);
      }, 50);
    }

    return;
  }

  // ✅ 無 request → reset
  hasShownInboxRef.current = false;

}, [appStage, incomingRequests.length]);
// 用途：打開拒絕 / 取消點菜要求視窗
// 大廚可以額外寫訊息給發起人，也可以留空只傳官方通知
const openRejectModal = (req) => {
  setRejectTargetRequest(req);
  setRejectReasonInput('');
  setRejectModalVisible(true);
};
// 用途：確認拒絕 / 取消 request，可填訊息，可留空
const handleConfirmRejectRequest = async () => {
  try {
    if (!rejectTargetRequest) {
      return showMessage('此點菜要求不存在。');
    }

    const reason = rejectReasonInput.trim();

    await handleRejectRequest(rejectTargetRequest, reason);

    setRejectModalVisible(false);
    setRejectTargetRequest(null);
    setRejectReasonInput('');
  } catch (error) {
    console.log('handleConfirmRejectRequest error:', error);
    showMessage('拒絕失敗', error.message || String(error));
  }
};
// 用途：cook 拒絕 / 取消點菜要求；如果畫面合併了多個相同 request，就一次全部拒絕
// reason 可以空白；如果空白，就寫入 official 通知
const handleRejectRequest = async (reqItem, reason = '') => {
  try {
    const ids = Array.isArray(reqItem?.mergedRequestIds)
      ? reqItem.mergedRequestIds
      : [reqItem?.id];

    const targetRequests = (requests || []).filter(req =>
      ids.includes(req.id)
    );

    if (targetRequests.length === 0) {
      return showMessage('此點菜要求不存在。');
    }

const actionDisplayName = nickname || email || '對方';

const isFruitRequest = targetRequests[0]?.requestType === 'fruit';

const officialNotice = isFruitRequest
  ? `${actionDisplayName}取消要求囉。`
  : `${actionDisplayName}取消要求囉。`;

const finalMessage = reason
  ? `${officialNotice}\n${actionDisplayName}留言：${reason}`
  : officialNotice;

    for (const targetReq of targetRequests) {
      await db.collection('requests').update(targetReq.id, {
        dishId: targetReq.dishId || '',
        dishName: targetReq.dishName || '',
        ingredients: targetReq.ingredients || '',
requestType: targetReq.requestType || 'dish',
fruitId: targetReq.fruitId || '',
fruitName: targetReq.fruitName || '',
targetPersonEmail: targetReq.targetPersonEmail || '',
targetPersonName: targetReq.targetPersonName || '',
        groupCode: targetReq.groupCode || groupInviteCode || '',
        familyGroupName: targetReq.familyGroupName || familyGroupName || '',

        groupMemberEmails:
          Array.isArray(targetReq.groupMemberEmails) && targetReq.groupMemberEmails.length > 0
            ? targetReq.groupMemberEmails
            : getCurrentGroupMemberEmails(),

        groupAdminEmails:
          Array.isArray(targetReq.groupAdminEmails) && targetReq.groupAdminEmails.length > 0
            ? targetReq.groupAdminEmails
            : (Array.isArray(groupAdminEmails) ? groupAdminEmails : []),

        senderEmail: targetReq.senderEmail || '',
        senderNickname: targetReq.senderNickname || targetReq.sender || '',

        targetCookEmail: targetReq.targetCookEmail || '',
        targetCookName: targetReq.targetCookName || targetReq.target || '',

        date:
  targetReq.requestType === 'fruit'
    ? ''
    : (targetReq.date || ''),
        meal:
  targetReq.requestType === 'fruit'
    ? ''
    : (targetReq.meal || ''),

        status: 'rejected',

        autoAddToList: targetReq.autoAddToList || false,
        cookApprovedAddToList: targetReq.cookApprovedAddToList || false,

rejectionReason: reason,
cookMessage: finalMessage,

// 新通知產生後，先把「操作的大廚自己」標記為已讀
// 這樣如果大廚同時也是發起人，就不會收到自己發出的通知
cookMessageReadByEmails: email ? [email] : [],

        // 如果之前有改期原因，保留記錄
        rescheduleReason: targetReq.rescheduleReason || '',

        createdAt: targetReq.createdAt || new Date(),
        updatedAt: new Date(),

        approvedAt: targetReq.approvedAt || '',
        approvedByEmail: targetReq.approvedByEmail || '',
        approvedByNickname: targetReq.approvedByNickname || '',

        rejectedAt: new Date(),
        rejectedByEmail: email || '',
        rejectedByNickname: nickname || '',

        rescheduledAt: targetReq.rescheduledAt || '',
        rescheduledByEmail: targetReq.rescheduledByEmail || '',
        rescheduledByNickname: targetReq.rescheduledByNickname || ''
      });
    }

    const remainingIncomingRequests = (incomingRequests || []).filter(req =>
      !ids.includes(req.id)
    );

    await loadRequestsFromFirebase();

    if (remainingIncomingRequests.length === 0) {
      setRequestInboxVisible(false);
    } else {
      setRequestInboxVisible(true);
    }

  } catch (error) {
    console.log('handleRejectRequest error:', error);
    showMessage('拒絕點菜要求失敗', error.message || String(error));
  }
};

// 用途：大廚標記排餐已完成，完成後從排餐動態和月曆中隱藏
const handleCompleteRequest = async (idOrIds) => {
  try {
    const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];

    const targetRequests = (requests || []).filter(req =>
      ids.includes(req.id)
    );

    if (targetRequests.length === 0) {
      return showMessage('完成的排餐不存在。');
    }

    for (const targetReq of targetRequests) {
      await db.collection('requests').update(targetReq.id, {
        dishId: targetReq.dishId || '',
        dishName: targetReq.dishName || '',
        ingredients: targetReq.ingredients || '',
requestType: targetReq.requestType || 'dish',
fruitId: targetReq.fruitId || '',
fruitName: targetReq.fruitName || '',
targetPersonEmail: targetReq.targetPersonEmail || '',
targetPersonName: targetReq.targetPersonName || '',
        groupCode: targetReq.groupCode || groupInviteCode || '',
        familyGroupName: targetReq.familyGroupName || familyGroupName || '',

        groupMemberEmails:
          Array.isArray(targetReq.groupMemberEmails) && targetReq.groupMemberEmails.length > 0
            ? targetReq.groupMemberEmails
            : getCurrentGroupMemberEmails(),

        groupAdminEmails:
          Array.isArray(targetReq.groupAdminEmails) && targetReq.groupAdminEmails.length > 0
            ? targetReq.groupAdminEmails
            : (Array.isArray(groupAdminEmails) ? groupAdminEmails : []),

        senderEmail: targetReq.senderEmail || '',
        senderNickname: targetReq.senderNickname || targetReq.sender || '',

        targetCookEmail: targetReq.targetCookEmail || '',
        targetCookName: targetReq.targetCookName || targetReq.target || '',

        date:
  targetReq.requestType === 'fruit'
    ? ''
    : (targetReq.date || ''),
        meal:
  targetReq.requestType === 'fruit'
    ? ''
    : (targetReq.meal || ''),

        // 重要：標記已完成
        status: 'completed',

        autoAddToList: targetReq.autoAddToList || false,
        cookApprovedAddToList: targetReq.cookApprovedAddToList || false,

        // 保留大廚之前給發起人的訊息
        cookMessage: targetReq.cookMessage || '',
        rejectionReason: targetReq.rejectionReason || '',
        rescheduleReason: targetReq.rescheduleReason || '',

        createdAt: targetReq.createdAt || new Date(),
        updatedAt: new Date(),

        approvedAt: targetReq.approvedAt || '',
        approvedByEmail: targetReq.approvedByEmail || '',
        approvedByNickname: targetReq.approvedByNickname || '',

        rejectedAt: targetReq.rejectedAt || '',
        rejectedByEmail: targetReq.rejectedByEmail || '',
        rejectedByNickname: targetReq.rejectedByNickname || '',

        rescheduledAt: targetReq.rescheduledAt || '',
        rescheduledByEmail: targetReq.rescheduledByEmail || '',
        rescheduledByNickname: targetReq.rescheduledByNickname || '',

        completedAt: new Date(),
        completedByEmail: email || '',
        completedByNickname: nickname || ''
      });
    }

    await loadRequestsFromFirebase();

  } catch (error) {
    console.log('handleCompleteRequest error:', error);
    showMessage('標記完成失敗', error.message || String(error));
  }
};

// 用途：取得目前群組所有成員 email，修復舊 request 權限欄位用
const getCurrentGroupMemberEmails = () => {
  const emails = (groupMembers || [])
    .map(member => member.email)
    .filter(Boolean);

  if (email && !emails.includes(email)) {
    emails.push(email);
  }

if (targetCookEmail && !emails.includes(targetCookEmail)) {
  emails.push(targetCookEmail);
}

if (fruitTargetEmail && !emails.includes(fruitTargetEmail)) {
  emails.push(fruitTargetEmail);
}

  return emails;
};

// 用途：打開改期視窗；如果是合併 request，就一次改全部
// 日期和餐次都預設用原本 request 的資料，但可以修改
const openRescheduleModal = (req) => {
  if (rescheduleModalVisible) return;

  setRescheduleTargetId(req.mergedRequestIds || [req.id]);
  setRescheduleDateInput(req.date || '');

  // 預設餐次 = 改期前原本餐次
  setRescheduleMealInput(req.meal || '');

  // 一開始只顯示目前餐次，不展開所有選項
  setRescheduleMealOptionsVisible(false);

  setRescheduleReasonInput('');
  setIsRescheduleSubmitting(false);
  setRescheduleModalVisible(true);
};


// 用途：cook 改期，並將合併的點菜要求全部維持為 approved
// 日期和餐次都可以修改；訊息可以留空
const handleConfirmReschedule = async () => {
  try {
    if (isRescheduleSubmitting) return;

    const normalizedDate = normalizeDateString(rescheduleDateInput);
const reason = rescheduleReasonInput.trim();

if (!rescheduleDateInput) {
  return showMessage('請輸入新日期。');
}

if (isPastDate(normalizedDate)) {
  return showMessage('不能改到已過去的日子。');
}

    const ids = Array.isArray(rescheduleTargetId)
      ? rescheduleTargetId
      : [rescheduleTargetId];

    const targetRequests = (requests || []).filter(req =>
      ids.includes(req.id)
    );

    if (targetRequests.length === 0) {
      return showMessage('改期的點菜要求不存在。');
    }

    // 用途：改期時可同步修改餐次
    // 如果沒有手動改，就沿用原本 request 的餐次
    const newMeal = rescheduleMealInput || targetRequests[0]?.meal || '';

    if (!newMeal) {
      return showMessage('請選擇改期後的餐次。');
    }

    setIsRescheduleSubmitting(true);

    const cookDisplayName =
      nickname ||
      email ||
      '大廚';

    // 如果你不想通知裡顯示餐次，可以把「（${newMeal}）」刪走
    const officialNotice =
      `${cookDisplayName}已將點菜安排改期至 ${normalizedDate}（${newMeal}）。`;

    const finalMessage = reason
      ? `${officialNotice}\n${cookDisplayName}留言：${reason}`
      : officialNotice;

    for (const targetReq of targetRequests) {
      await db.collection('requests').update(targetReq.id, {
        dishId: targetReq.dishId || '',
        dishName: targetReq.dishName || '',
        ingredients: targetReq.ingredients || '',
requestType: targetReq.requestType || 'dish',
fruitId: targetReq.fruitId || '',
fruitName: targetReq.fruitName || '',
targetPersonEmail: targetReq.targetPersonEmail || '',
targetPersonName: targetReq.targetPersonName || '',
        groupCode: targetReq.groupCode || groupInviteCode || '',
        familyGroupName: targetReq.familyGroupName || familyGroupName || '',

        groupMemberEmails:
          Array.isArray(targetReq.groupMemberEmails) && targetReq.groupMemberEmails.length > 0
            ? targetReq.groupMemberEmails
            : getCurrentGroupMemberEmails(),

        groupAdminEmails:
          Array.isArray(targetReq.groupAdminEmails) && targetReq.groupAdminEmails.length > 0
            ? targetReq.groupAdminEmails
            : (Array.isArray(groupAdminEmails) ? groupAdminEmails : []),

        senderEmail: targetReq.senderEmail || '',
        senderNickname: targetReq.senderNickname || targetReq.sender || '',

        targetCookEmail: targetReq.targetCookEmail || '',
        targetCookName: targetReq.targetCookName || targetReq.target || '',

        date: normalizedDate,
        meal: newMeal,

        status: 'approved',

        autoAddToList: targetReq.autoAddToList || false,
        cookApprovedAddToList: targetReq.cookApprovedAddToList || false,

        // 給發起人 / 其他大廚看的通知內容
        rescheduleReason: reason,
        cookMessage: finalMessage,

// 新通知產生後，先把「操作的大廚自己」標記為已讀
// 這樣如果大廚同時也是發起人，就不會收到自己發出的通知
cookMessageReadByEmails: email ? [email] : [],

        rejectionReason: '',

        createdAt: targetReq.createdAt || new Date(),
        updatedAt: new Date(),

        approvedAt: targetReq.approvedAt || new Date(),
        approvedByEmail: targetReq.approvedByEmail || email || '',
        approvedByNickname: targetReq.approvedByNickname || nickname || '',

        rejectedAt: '',
        rejectedByEmail: '',
        rejectedByNickname: '',

        rescheduledAt: new Date(),
        rescheduledByEmail: email || '',
        rescheduledByNickname: nickname || ''
      });
    }

    await loadRequestsFromFirebase();

setRescheduleModalVisible(false);
setRescheduleTargetId(null);
setRescheduleDateInput('');
setRescheduleMealInput('');
setRescheduleMealOptionsVisible(false);
setRescheduleReasonInput('');
setIsRescheduleSubmitting(false);

    const remainingIncomingRequests = (incomingRequests || []).filter(req =>
      !ids.includes(req.id)
    );

    if (remainingIncomingRequests.length === 0) {
      setRequestInboxVisible(false);
    } else {
      setRequestInboxVisible(true);
    }

  } catch (error) {
    console.log('handleConfirmReschedule error:', error);
    setIsRescheduleSubmitting(false);
    showMessage('改期失敗', error.message || String(error));
  }
};

//加菜式
  const [newDishName, setNewDishName] = useState('');
  const [newDishIngredients, setNewDishIngredients] = useState('');
  const [addPageSelectedTags, setAddPageSelectedTags] = useState([]);
  const [isPublic, setIsPublic] = useState(false);
  
const recommendedDishes = useMemo(() => {
  if (!newDishName.trim()) return [];
  return dishes.filter(d => d.name.includes(newDishName.trim()));
}, [newDishName, dishes]);



  const [shoppingList, setShoppingList] = useState([]);
  const [manualIngredientInput, setManualIngredientInput] = useState('');


// 1. === 升級版：自動匹配分類與標籤圖示的輔助邏輯 ===
  const matchCategoryEmoji = (name, isTag = false) => {
    const emojiRegex = /[\u{1F300}-\u{1F9FF}]/u;
    if (emojiRegex.test(name)) return name;


    const n = name.toLowerCase();


    if (isTag) {
      if (n.includes('豬')) return `🐷 ${name}`;
      if (n.includes('牛')) return `🥩 ${name}`;
      if (n.includes('雞') || n.includes('鳥')) return `🐔 ${name}`;
      if (n.includes('鴨') || n.includes('鵝')) return `🦆 ${name}`;
      if (n.includes('魚')) return `🐟 ${name}`;
      if (n.includes('蝦')) return `🦐 ${name}`;
      if (n.includes('蟹')) return `🦀 ${name}`;
      if (n.includes('蛤') || n.includes('貝') || n.includes('蚵') || n.includes('蜆')) return `🦪 ${name}`;
      if (n.includes('透抽') || n.includes('花枝') || n.includes('軟絲') || n.includes('小卷') || n.includes('魷魚')) return `🦑 ${name}`;
      if (n.includes('蛋')) return `🥚 ${name}`;
      if (n.includes('豆腐') || n.includes('豆干') || n.includes('腐皮')) return `🧀 ${name}`;
      if (n.includes('菜') || n.includes('筍') || n.includes('蘿蔔')) return `🥬 ${name}`;
      if (n.includes('菇') || n.includes('蕈') || n.includes('木耳')) return `🍄 ${name}`;
      if (n.includes('豆')) return `🫘 ${name}`;
      if (n.includes('瓜') || n.includes('茄') || n.includes('椒')) return `🌽 ${name}`;
      if (n.includes('飯') || n.includes('米')) return `🍚 ${name}`;
      if (n.includes('麵') || n.includes('粉') || n.includes('烏龍')) return `🍜 ${name}`;
      if (n.includes('餃') || n.includes('包') || n.includes('燒賣')) return `🥟 ${name}`;
      if (n.includes('麵包') || n.includes('吐司') || n.includes('烘焙')) return `🍞 ${name}`;
     
      const randomTagEmojis = ['✨', '🍽️', '🍳', '🍯', '🧂', '🥢', '🍙', '🌯'];
      const randomIndex = Math.abs(name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)) % randomTagEmojis.length;
      return `${randomTagEmojis[randomIndex]} ${name}`;
    }


    if (n.includes('台') || n.includes('夜市') || n.includes('小吃')) return `🏮 ${name}`;
    if (n.includes('日') || n.includes('壽司') || n.includes('居酒屋')) return `🍣 ${name}`;
    if (n.includes('港') || n.includes('點心') || n.includes('飲茶')) return `🥢 ${name}`;
    if (n.includes('韓') || n.includes('泡菜') || n.includes('烤肉')) return `🇰🇷 ${name}`;
    if (n.includes('泰') || n.includes('東南亞') || n.includes('越')) return `🇹🇭 ${name}`;
    if (n.includes('西') || n.includes('歐') || n.includes('義') || n.includes('法')) return `🇮🇹 ${name}`;
    if (n.includes('美') || n.includes('漢堡') || n.includes('炸雞')) return `🇺🇸 ${name}`;
    if (n.includes('川') || n.includes('辣') || n.includes('麻辣')) return `🌶️ ${name}`;
    if (n.includes('甜') || n.includes('蛋糕') || n.includes('點心') || n.includes('下午茶')) return `🍰 ${name}`;
    if (n.includes('健康') || n.includes('素') || n.includes('蔬') || n.includes('減脂') || n.includes('生酮')) return `🌱 ${name}`;
    if (n.includes('湯') || n.includes('羹') || n.includes('燉品')) return `🥣 ${name}`;
    if (n.includes('飲') || n.includes('茶') || n.includes('咖啡') || n.includes('微醺')) return `🥤 ${name}`;
    if (n.includes('宵夜') || n.includes('炸物') || n.includes('烤串')) return `🍢 ${name}`;
    if (n.includes('早午餐') || n.includes('早餐')) return `🍳 ${name}`;
   
    const randomCatEmojis = ['📁', '📂', '🗂️', '🗃️', '📋', '🔖'];
    const randomIndex = Math.abs(name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)) % randomCatEmojis.length;
    return `${randomCatEmojis[randomIndex]} ${name}`;
  };

// 用途：從 INITIAL_TAG_CATEGORIES 找出所有系統預設標籤
const getInitialTagSet = () => {
  const tagSet = new Set();

  Object.keys(INITIAL_TAG_CATEGORIES).forEach(catKey => {
    const cat = INITIAL_TAG_CATEGORIES[catKey];

    if (cat.isNested) {
      Object.keys(cat.subCategories || {}).forEach(subKey => {
        const tags = cat.subCategories[subKey].tags || [];
        tags.forEach(tag => tagSet.add(tag));
      });
    } else {
      const tags = cat.tags || [];
      tags.forEach(tag => tagSet.add(tag));
    }
  });

  return tagSet;
};

// 用途：取得某個分類底下所有標籤
const getTagsFromCategory = (cat) => {
  let result = [];

  if (!cat) return result;

  if (cat.isNested) {
    Object.keys(cat.subCategories || {}).forEach(subKey => {
      const subCat = cat.subCategories[subKey];
      result = [...result, ...(subCat.tags || [])];
    });
  } else {
    result = [...(cat.tags || [])];
  }

  return result;
};

// 用途：取得目前 dynamicCategories 入面所有「後加」的自訂標籤
const getCustomAddedTags = () => {
  const initialTagSet = getInitialTagSet();
  const result = [];

  Object.keys(dynamicCategories || {}).forEach(catKey => {
    const cat = dynamicCategories[catKey];

    if (cat.isNested) {
      Object.keys(cat.subCategories || {}).forEach(subKey => {
        const subCat = cat.subCategories[subKey];
        const tags = subCat.tags || [];

        tags.forEach(tag => {
          if (!initialTagSet.has(tag)) {
            result.push({
              tag,
              catKey,
              subKey,
              categoryTitle: cat.title,
              subCategoryTitle: subCat.title
            });
          }
        });
      });
    } else {
      const tags = cat.tags || [];

      tags.forEach(tag => {
        if (!initialTagSet.has(tag)) {
          result.push({
            tag,
            catKey,
            subKey: null,
            categoryTitle: cat.title,
            subCategoryTitle: ''
          });
        }
      });
    }
  });

  return result;
};

// 用途：取得所有後加的自訂分類
// 規則：INITIAL_TAG_CATEGORIES 原本沒有的分類 key，就視為自訂分類
const getCustomAddedCategories = () => {
  return Object.keys(dynamicCategories || {})
    .filter(catKey => !INITIAL_TAG_CATEGORIES[catKey])
    .map(catKey => {
      const cat = dynamicCategories[catKey];

      return {
        catKey,
        title: cat.title,
        tagCount: getTagsFromCategory(cat).length
      };
    });
};

// 用途：勾選 / 取消勾選自訂標籤
const toggleCustomTagSelection = (tag) => {
  setSelectedCustomTagNames(prev =>
    prev.includes(tag)
      ? prev.filter(item => item !== tag)
      : [...prev, tag]
  );
};

// 用途：勾選 / 取消勾選自訂分類
const toggleCustomCategorySelection = (catKey) => {
  setSelectedCustomCategoryKeys(prev =>
    prev.includes(catKey)
      ? prev.filter(item => item !== catKey)
      : [...prev, catKey]
  );
};

// 用途：一次刪除多個自訂標籤 / 自訂分類，並同步到 Firebase
const handleDeleteSelectedCustomItems = async () => {
  const tagsToDelete = selectedCustomTagNames;
  const categoriesToDelete = selectedCustomCategoryKeys;

  if (tagsToDelete.length === 0 && categoriesToDelete.length === 0) {
    return showMessage('請先選擇自訂分類或標籤。');
  }

  let tagsInsideDeletedCategories = [];

  categoriesToDelete.forEach(catKey => {
    const cat = dynamicCategories[catKey];
    tagsInsideDeletedCategories = [
      ...tagsInsideDeletedCategories,
      ...getTagsFromCategory(cat)
    ];
  });

  const allTagsToRemove = Array.from(
    new Set([...tagsToDelete, ...tagsInsideDeletedCategories])
  );

  const updated = { ...dynamicCategories };

  // 1. 刪除整個自訂分類
  categoriesToDelete.forEach(catKey => {
    delete updated[catKey];
  });

  // 2. 從剩餘分類中刪除已選自訂標籤
  Object.keys(updated).forEach(catKey => {
    const cat = updated[catKey];

    if (cat.isNested) {
      const newSubCategories = { ...cat.subCategories };

      Object.keys(newSubCategories).forEach(subKey => {
        const subCat = newSubCategories[subKey];

        newSubCategories[subKey] = {
          ...subCat,
          tags: (subCat.tags || []).filter(tag => !tagsToDelete.includes(tag))
        };
      });

      updated[catKey] = {
        ...cat,
        subCategories: newSubCategories
      };
    } else {
      updated[catKey] = {
        ...cat,
        tags: (cat.tags || []).filter(tag => !tagsToDelete.includes(tag))
      };
    }
  });

  // 如果刪除的是目前正在選擇的分類，要清空選擇
  if (categoriesToDelete.includes(selectedModalCat)) {
    setSelectedModalCat('none');
    setSelectedSubModalCat('');
  }

  // 同步移除首頁已選標籤
  setSelectedTags(prev =>
    Array.isArray(prev)
      ? prev.filter(tag => !allTagsToRemove.includes(tag))
      : []
  );

  // 同步移除新增菜式頁已選標籤
  setAddPageSelectedTags(prev =>
    Array.isArray(prev)
      ? prev.filter(tag => !allTagsToRemove.includes(tag))
      : []
  );

  // 1. 更新本機
  setDynamicCategories(updated);

  // 2. 同步 Firebase
  await saveTagCategoriesToFirebase(updated);

  setSelectedCustomTagNames([]);
  setSelectedCustomCategoryKeys([]);

  
};
useEffect(() => {
  if (appStage === 'main' && groupInviteCode) {
    loadTagCategoriesFromFirebase();
  }
}, [appStage, groupInviteCode]);

// 用途：刪除自訂標籤
const handleDeleteCustomTag = (tagToDelete) => {
  setDynamicCategories(prev => {
    const updated = { ...prev };

    Object.keys(updated).forEach(catKey => {
      const cat = updated[catKey];

      if (cat.isNested) {
        const newSubCategories = { ...cat.subCategories };

        Object.keys(newSubCategories).forEach(subKey => {
          const subCat = newSubCategories[subKey];

          newSubCategories[subKey] = {
            ...subCat,
            tags: (subCat.tags || []).filter(tag => tag !== tagToDelete)
          };
        });

        updated[catKey] = {
          ...cat,
          subCategories: newSubCategories
        };
      } else {
        updated[catKey] = {
          ...cat,
          tags: (cat.tags || []).filter(tag => tag !== tagToDelete)
        };
      }
    });

    return updated;
  });

  // 同步移除首頁已選標籤
  setSelectedTags(prev =>
    Array.isArray(prev) ? prev.filter(tag => tag !== tagToDelete) : []
  );

  // 同步移除新增菜式頁已選標籤
  setAddPageSelectedTags(prev =>
    Array.isArray(prev) ? prev.filter(tag => tag !== tagToDelete) : []
  );

};

// 用途：從 Firebase 讀取目前群組共用的分類 / 標籤設定
const loadTagCategoriesFromFirebase = async () => {
  try {
    if (!groupInviteCode) {
      setDynamicCategories(INITIAL_TAG_CATEGORIES);
      return;
    }

    const groups = await db.collection('familyGroups').getAll();
    const currentGroup = groups.find(g => g.inviteCode === groupInviteCode);

    if (!currentGroup) {
      setDynamicCategories(INITIAL_TAG_CATEGORIES);
      return;
    }

const firebaseTagCategories = currentGroup.tagCategories;

    const isValidTagCategories =
      firebaseTagCategories &&
      typeof firebaseTagCategories === 'object' &&
      !Array.isArray(firebaseTagCategories);

    if (isValidTagCategories) {
      setDynamicCategories(firebaseTagCategories);
    } else {
      setDynamicCategories(INITIAL_TAG_CATEGORIES);

      // 修復舊資料：如果 Firebase 入面之前存錯成 []，自動寫回正確 object
      await db.collection('familyGroups').update(currentGroup.id, {
        groupName: currentGroup.groupName || '',
        inviteCode: currentGroup.inviteCode || '',
        createdByEmail: currentGroup.createdByEmail || '',
        createdByNickname: currentGroup.createdByNickname || '',
        ownerEmail: currentGroup.ownerEmail || '',
        adminEmails: Array.isArray(currentGroup.adminEmails) ? currentGroup.adminEmails : [],
        memberNames: Array.isArray(currentGroup.memberNames) ? currentGroup.memberNames : [],
        memberEmails: Array.isArray(currentGroup.memberEmails) ? currentGroup.memberEmails : [],
        tagCategories: INITIAL_TAG_CATEGORIES,
        createdAt: currentGroup.createdAt || new Date()
      });
    }
  } catch (error) {
    console.log('loadTagCategoriesFromFirebase error:', error);
    showMessage('載入分類標籤失敗', error.message || String(error));
  }
};

// 用途：把分類 / 標籤設定儲存到目前群組 Firebase 文件
const saveTagCategoriesToFirebase = async (nextCategories) => {
  try {
    const safeNextCategories =
      nextCategories &&
      typeof nextCategories === 'object' &&
      !Array.isArray(nextCategories)
        ? nextCategories
        : INITIAL_TAG_CATEGORIES;

    if (!groupInviteCode) {
      return showMessage('沒有此群組。');
    }

    const groups = await db.collection('familyGroups').getAll();
    const currentGroup = groups.find(g => g.inviteCode === groupInviteCode);

    if (!currentGroup) {
      return showMessage('沒有此群組。');
    }

    await db.collection('familyGroups').update(currentGroup.id, {
      groupName: currentGroup.groupName || '',
      inviteCode: currentGroup.inviteCode || '',
      createdByEmail: currentGroup.createdByEmail || '',
      createdByNickname: currentGroup.createdByNickname || '',

      ownerEmail: currentGroup.ownerEmail || '',
      adminEmails: Array.isArray(currentGroup.adminEmails) ? currentGroup.adminEmails : [],

      memberNames: Array.isArray(currentGroup.memberNames) ? currentGroup.memberNames : [],
      memberEmails: Array.isArray(currentGroup.memberEmails) ? currentGroup.memberEmails : [],

      // 用途：群組共用分類 / 標籤設定
      tagCategories: safeNextCategories,

      createdAt: currentGroup.createdAt || new Date()
    });
  } catch (error) {
    console.log('saveTagCategoriesToFirebase error:', error);
    showMessage('同步分類標籤失敗', error.message || String(error));
  }
};

  // 用途：儲存新增分類 / 標籤，並同步到 Firebase 群組共用設定
const handleSaveTagsAndCategories = async () => {
  const catNameTrim = newCategoryName.trim();
  const tagNameTrim = newModalTagName.trim();

  if (!catNameTrim && !tagNameTrim) {
    showMessage('請輸入自訂分類或標籤');
    return;
  }

  const updated = { ...dynamicCategories };
  let targetKey = selectedModalCat;

  // 情況一：有建立新大分類
  if (catNameTrim) {
    targetKey = `custom_${Date.now()}`;

    updated[targetKey] = {
      title: matchCategoryEmoji(catNameTrim),
      isNested: false,
      tags: []
    };
  }

  // 情況二：有建立新標籤
  if (tagNameTrim) {
    const finalTagName = matchCategoryEmoji(tagNameTrim, true);

    if (!catNameTrim && (targetKey === 'none' || !updated[targetKey])) {
      targetKey = 'others';
    }

    if (targetKey === 'others' && !updated.others) {
      updated.others = {
        title: '📁 其他',
        isNested: false,
        tags: []
      };
    }

    if (updated[targetKey].isNested) {
      const subKey =
        selectedSubModalCat ||
        Object.keys(updated[targetKey].subCategories || {})[0];

      if (updated[targetKey].subCategories?.[subKey]) {
        const oldTags = updated[targetKey].subCategories[subKey].tags || [];

        if (!oldTags.includes(finalTagName)) {
          updated[targetKey] = {
            ...updated[targetKey],
            subCategories: {
              ...updated[targetKey].subCategories,
              [subKey]: {
                ...updated[targetKey].subCategories[subKey],
                tags: [...oldTags, finalTagName]
              }
            }
          };
        }
      }
    } else {
      const oldTags = updated[targetKey].tags || [];

      if (!oldTags.includes(finalTagName)) {
        updated[targetKey] = {
          ...updated[targetKey],
          tags: [...oldTags, finalTagName]
        };
      }
    }
  }

  // 1. 先更新本機畫面
  setDynamicCategories(updated);

  // 2. 再同步到 Firebase，讓同群組成員看到一樣標籤
  await saveTagCategoriesToFirebase(updated);

  // 重置所有表單狀態
  setNewCategoryName('');
  setNewModalTagName('');
  setSelectedModalCat('none');
  setSelectedSubModalCat('');
  setShowMoreModalCats(false);
  setCustomModalVisible(false);
};

//月曆
  const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
  const firstDayOfWeek = new Date(currentYear, currentMonth - 1, 1).getDay();
  const blanks = Array(firstDayOfWeek).fill(null);
  const daysArray = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const calendarCells = [...blanks, ...daysArray];


  const handlePrevMonth = () => {
    if (currentMonth === 1) { setCurrentMonth(12); setCurrentYear(currentYear - 1); }
    else { setCurrentMonth(currentMonth - 1); }
  };


  const handleNextMonth = () => {
    if (currentMonth === 12) { setCurrentMonth(1); setCurrentYear(currentYear + 1); }
    else { setCurrentMonth(currentMonth + 1); }
  };
// =====================
// 分頁 3：特別通知月曆
// =====================
const specialNoticeDaysInMonth = new Date(
  specialNoticeYear,
  specialNoticeMonth,
  0
).getDate();

const specialNoticeFirstDayOfWeek = new Date(
  specialNoticeYear,
  specialNoticeMonth - 1,
  1
).getDay();

const specialNoticeBlanks = Array(specialNoticeFirstDayOfWeek).fill(null);

const specialNoticeDaysArray = Array.from(
  { length: specialNoticeDaysInMonth },
  (_, i) => i + 1
);

const specialNoticeCalendarCells = [
  ...specialNoticeBlanks,
  ...specialNoticeDaysArray
];

const handlePrevSpecialNoticeMonth = () => {
  if (specialNoticeMonth === 1) {
    setSpecialNoticeMonth(12);
    setSpecialNoticeYear(specialNoticeYear - 1);
  } else {
    setSpecialNoticeMonth(specialNoticeMonth - 1);
  }
};

const handleNextSpecialNoticeMonth = () => {
  if (specialNoticeMonth === 12) {
    setSpecialNoticeMonth(1);
    setSpecialNoticeYear(specialNoticeYear + 1);
  } else {
    setSpecialNoticeMonth(specialNoticeMonth + 1);
  }
};
// 用途：打開特別通知日期月曆，並跳到目前已選日期的月份
const openSpecialNoticeCalendar = () => {
  const normalized = normalizeDateString(specialNoticeDateInput);

  if (normalized) {
    const parts = normalized.split('-');

    if (parts.length === 3) {
      const y = Number(parts[0]);
      const m = Number(parts[1]);

      if (!Number.isNaN(y) && !Number.isNaN(m)) {
        setSpecialNoticeYear(y);
        setSpecialNoticeMonth(m);
      }
    }
  }

  setSpecialNoticeCalendarVisible(true);
};
// 用途：載入目前群組對菜式標籤的加減紀錄
const loadDishTagOverrides = async () => {
  try {
    if (!groupInviteCode) {
      setCurrentGroupDocId('');
      setDishTagOverrides({});
      return;
    }

    // 先用 inviteCode 找到 familyGroups document id
    const groups = await db.collection('familyGroups').getAll();
    const currentGroup = (Array.isArray(groups) ? groups : []).find(
      group => group.inviteCode === groupInviteCode
    );

    if (!currentGroup?.id) {
      setCurrentGroupDocId('');
      setDishTagOverrides({});
      return;
    }

    setCurrentGroupDocId(currentGroup.id);

    const overridePath = `familyGroups/${currentGroup.id}/dishTagOverrides`;
    const overrides = await db.collection(overridePath).getAll();

    const overrideMap = {};

    (Array.isArray(overrides) ? overrides : []).forEach(item => {
      if (!item?.dishId && !item?.id) return;

      const dishId = item.dishId || item.id;

      overrideMap[dishId] = {
        id: item.id,
        dishId,
        addedTags: Array.isArray(item.addedTags) ? item.addedTags : [],
        removedTags: Array.isArray(item.removedTags) ? item.removedTags : [],
        groupCode: item.groupCode || ''
      };
    });

    setDishTagOverrides(overrideMap);
  } catch (error) {
    console.log('loadDishTagOverrides error:', error);
    showMessage('載入群組菜式標籤失敗', error.message || String(error));
  }
};

// 用途：從 Firebase 重新載入所有菜式資料
const loadDishes = async () => {
  try {
    const allDishes = await db.collection('dishes').getAll();
setDishes(Array.isArray(allDishes) ? allDishes : []);

    console.log('已從 Firebase 載入 dishes:', allDishes);
  } catch (error) {
    console.log('loadDishes error:', error);
    showMessage('載入菜式失敗', error.message || String(error));
  }
};

useEffect(() => {
  if (appStage === 'main') {
    loadDishes();
  }
}, [appStage]);
useEffect(() => {
  if (appStage === 'main') {
    loadDishTagOverrides();
  }
}, [appStage, groupInviteCode]);
//新菜式後台
const availableDishes = useMemo(() => {
  return dishes.filter(d => {
    const status = String(
      d.publishStatus ?? (d.isPublic ? 'approved' : 'private')
    ).trim().toLowerCase();

    const hiddenForGroups = Array.isArray(d.hiddenForGroups) ? d.hiddenForGroups : [];

    // 如果此菜式已被目前群組隱藏，就任何情況都不顯示
    if (groupInviteCode && hiddenForGroups.includes(groupInviteCode)) {
      return false;
    }

    // 已公開：所有人、所有群組可見
    if (status === 'approved') return true;

    // 私房：只限同群組可見
    if (status === 'private') {
      return d.groupCode === groupInviteCode;
    }

    // 待確認：只限建立者自己可見
    if (status === 'pending') {
      return d.createdByEmail === email;
    }

    return false;
  });
}, [dishes, groupInviteCode, email]);

const availableFruits = useMemo(() => {
  return (fruits || []).filter(fruit => {
    const status = String(
      fruit.publishStatus ?? (fruit.isPublic ? 'approved' : 'private')
    ).trim().toLowerCase();

    const hiddenForGroups = Array.isArray(fruit.hiddenForGroups)
      ? fruit.hiddenForGroups
      : [];

    if (groupInviteCode && hiddenForGroups.includes(groupInviteCode)) {
      return false;
    }

    if (status === 'approved') return true;

    if (status === 'private') {
      return fruit.groupCode === groupInviteCode;
    }

    if (status === 'pending') {
      return fruit.createdByEmail === email;
    }

    return false;
  });
}, [fruits, groupInviteCode, email]);

// 用途：分頁1 
const [addDishModalVisible, setAddDishModalVisible] = useState(false);
const [addFruitModalVisible, setAddFruitModalVisible] = useState(false);
// 用途：取得菜式在目前群組實際可見的標籤
// 原本 dish.tags + 本群組 addedTags - 本群組 removedTags
const getDishVisibleTags = (dish) => {
  if (!dish) return [];

  const baseTags = Array.isArray(dish.tags) ? dish.tags : [];
  const override = dishTagOverrides?.[dish.id] || {};

  const addedTags = Array.isArray(override.addedTags)
    ? override.addedTags
    : [];

  const removedTags = Array.isArray(override.removedTags)
    ? override.removedTags
    : [];

  const mergedTags = [...baseTags];

  addedTags.forEach(tag => {
    if (tag && !mergedTags.includes(tag)) {
      mergedTags.push(tag);
    }
  });

  return mergedTags.filter(tag => !removedTags.includes(tag));
};

// 用途：分頁1 實際顯示 / 搜尋 / 標籤篩選後的菜式
// 重要：抽籤也應該用這個結果，才會跟搜尋和標籤同步
const displayedDishes = useMemo(() => {
  const keyword = String(searchQuery || '').trim().toLowerCase();
  const safeSelectedTags = Array.isArray(selectedTags) ? selectedTags : [];

  return (availableDishes || []).filter(dish => {
    const dishName = String(dish.name || '').toLowerCase();
    const ingredients = String(dish.ingredients || '').toLowerCase();
const dishTags = getDishVisibleTags(dish);
const tagsText = dishTags.join(' ').toLowerCase();

    const matchKeyword =
      !keyword ||
      dishName.includes(keyword) ||
      ingredients.includes(keyword) ||
      tagsText.includes(keyword);

    const matchTags =
      safeSelectedTags.length === 0 ||
      safeSelectedTags.every(tag => dishTags.includes(tag));

    return matchKeyword && matchTags;
  });
}, [availableDishes, searchQuery, selectedTags]);

// 用途：找出目前群組已隱藏的菜式，供 admin 在編輯模式下查看和還原
const hiddenDishesForCurrentGroup = useMemo(() => {
  return dishes.filter(d => {
    const hiddenForGroups = Array.isArray(d.hiddenForGroups) ? d.hiddenForGroups : [];
    return groupInviteCode && hiddenForGroups.includes(groupInviteCode);
  });
}, [dishes, groupInviteCode]);

// 用途：編輯模式下搜尋家庭菜餚庫的菜式
// 注意：非編輯模式時，直接顯示原本 displayedDishes
const editableDisplayedDishes = useMemo(() => {
  const baseDishes = Array.isArray(displayedDishes)
    ? displayedDishes
    : Array.isArray(availableDishes)
      ? availableDishes
      : [];

  const keyword = dishEditSearchQuery.trim().toLowerCase();

  // 非編輯模式：不要額外過濾，直接用原本家庭菜餚庫清單
  if (!isDishEditMode) {
    return baseDishes;
  }

  // 編輯模式但沒有搜尋字：顯示全部可見菜式
  if (!keyword) {
    return baseDishes;
  }

  // 編輯模式有搜尋字：搜尋菜名、材料、標籤
  return baseDishes.filter(dish => {
    const name = String(dish.name || '').toLowerCase();
    const ingredients = String(dish.ingredients || '').toLowerCase();
    const tags = getDishVisibleTags(dish).join(' ').toLowerCase();

    return (
      name.includes(keyword) ||
      ingredients.includes(keyword) ||
      tags.includes(keyword)
    );
  });
}, [displayedDishes, availableDishes, dishEditSearchQuery, isDishEditMode]);

// 用途：編輯模式下勾選 / 取消勾選要一鍵隱藏的菜式
const toggleDishHideSelection = (dishId) => {
  if (!dishId) return;

  setSelectedDishIdsForHide(prev =>
    prev.includes(dishId)
      ? prev.filter(id => id !== dishId)
      : [...prev, dishId]
  );
};

// 用途：從 Firebase 重新載入所有水果資料
const loadFruits = async () => {
  try {
    const allFruits = await db.collection('fruits').getAll();

    const safeFruits = Array.isArray(allFruits) ? allFruits : [];

    // 如果 Firebase 未有水果，就先顯示內置預設水果
    setFruits(safeFruits.length > 0 ? safeFruits : INITIAL_FRUITS);

    console.log('已從 Firebase 載入 fruits:', allFruits);
  } catch (error) {
    console.log('loadFruits error:', error);

    // Firebase 失敗時仍顯示預設水果，避免空白
    setFruits(INITIAL_FRUITS);
  }
};

useEffect(() => {
  if (appStage === 'main') {
    loadFruits();
  }
}, [appStage]);
const displayedFruits = useMemo(() => {
  const keyword = String(fruitSearchQuery || '').trim().toLowerCase();
  const safeSelectedSeasons = Array.isArray(selectedFruitSeasons)
    ? selectedFruitSeasons
    : [];

  return (availableFruits || []).filter(fruit => {
    const fruitName = String(fruit.name || '').toLowerCase();
    const seasons = Array.isArray(fruit.seasons) ? fruit.seasons : [];
    const seasonsText = seasons.join(' ').toLowerCase();

    const matchKeyword =
      !keyword ||
      fruitName.includes(keyword) ||
      seasonsText.includes(keyword);

    const matchSeasons =
      safeSelectedSeasons.length === 0 ||
      safeSelectedSeasons.some(season => seasons.includes(season));

    return matchKeyword && matchSeasons;
  });
}, [availableFruits, fruitSearchQuery, selectedFruitSeasons]);

const hiddenFruitsForCurrentGroup = useMemo(() => {
  return (fruits || []).filter(fruit => {
    const hiddenForGroups = Array.isArray(fruit.hiddenForGroups)
      ? fruit.hiddenForGroups
      : [];

    return groupInviteCode && hiddenForGroups.includes(groupInviteCode);
  });
}, [fruits, groupInviteCode]);
const editableDisplayedFruits = useMemo(() => {
  const baseFruits = Array.isArray(displayedFruits)
    ? displayedFruits
    : Array.isArray(availableFruits)
      ? availableFruits
      : [];

  const keyword = fruitSearchQuery.trim().toLowerCase();

  if (!isFruitEditMode) {
    return baseFruits;
  }

  if (!keyword) {
    return baseFruits;
  }

  return baseFruits.filter(fruit => {
    const name = String(fruit.name || '').toLowerCase();
    const seasons = Array.isArray(fruit.seasons)
      ? fruit.seasons.join(' ').toLowerCase()
      : '';

    return name.includes(keyword) || seasons.includes(keyword);
  });
}, [displayedFruits, availableFruits, fruitSearchQuery, isFruitEditMode]);

const toggleFruitHideSelection = (fruitId) => {
  if (!fruitId) return;

  setSelectedFruitIdsForHide(prev =>
    prev.includes(fruitId)
      ? prev.filter(id => id !== fruitId)
      : [...prev, fruitId]
  );
};

const canPermanentlyDeleteFruitFromGroup = (fruit) => {
  if (!fruit) return false;

  const status = String(
    fruit.publishStatus ?? (fruit.isPublic ? 'approved' : 'private')
  ).trim().toLowerCase();

  const isCreatedByMe = fruit.createdByEmail === email;
  const isFromCurrentGroup = fruit.groupCode === groupInviteCode;
  const isApprovedPublic = status === 'approved' || fruit.isPublic === true;

  return isCreatedByMe && isFromCurrentGroup && !isApprovedPublic;
};

const handleAdminHideSelectedFruits = async () => {
  try {
    if (!isCurrentUserAdmin) {
      return showMessage('只有管理員可以管理水果庫。');
    }

    if (!groupInviteCode) {
      return showMessage('沒有此群組。');
    }

    if (selectedFruitIdsForHide.length === 0) {
      return showMessage('請先勾選要處理的水果。');
    }

    const targetFruits = (editableDisplayedFruits || []).filter(fruit =>
      selectedFruitIdsForHide.includes(fruit.id)
    );

    if (targetFruits.length === 0) {
      return showMessage('已選水果不存在。');
    }

    const deletedFruitIds = [];
    const hiddenFruitUpdates = [];

    for (const fruit of targetFruits) {
      if (!fruit?.id) continue;

      if (canPermanentlyDeleteFruitFromGroup(fruit)) {
        await db.collection('fruits').delete(fruit.id);
        deletedFruitIds.push(fruit.id);
        continue;
      }

      const oldHiddenGroups = Array.isArray(fruit.hiddenForGroups)
        ? fruit.hiddenForGroups
        : [];

      const updatedHiddenGroups = oldHiddenGroups.includes(groupInviteCode)
        ? oldHiddenGroups
        : [...oldHiddenGroups, groupInviteCode];

      await db.collection('fruits').update(fruit.id, {
        name: fruit.name || '',
        seasons: Array.isArray(fruit.seasons) ? fruit.seasons : [],
        createdByEmail: fruit.createdByEmail || '',
        createdByNickname: fruit.createdByNickname || '',
        familyGroupName: fruit.familyGroupName || '',
        groupCode: fruit.groupCode || '',
        isPublic: fruit.isPublic || false,
        requestedPublic: fruit.requestedPublic || false,
        publishStatus: fruit.publishStatus || (fruit.isPublic ? 'approved' : 'private'),
        hiddenForGroups: updatedHiddenGroups,
        createdAt: fruit.createdAt || new Date(),
        updatedAt: new Date()
      });

      hiddenFruitUpdates.push({
        id: fruit.id,
        hiddenForGroups: updatedHiddenGroups
      });
    }

    setFruits(prev =>
      prev
        .filter(fruit => !deletedFruitIds.includes(fruit.id))
        .map(fruit => {
          const update = hiddenFruitUpdates.find(item => item.id === fruit.id);

          if (!update) return fruit;

          return {
            ...fruit,
            hiddenForGroups: update.hiddenForGroups
          };
        })
    );

    setSelectedFruitIdsForHide([]);
  } catch (error) {
    console.log('handleAdminHideSelectedFruits error:', error);
    showMessage('操作失敗', error.message || String(error));
  }
};

const handleAdminRestoreHiddenFruit = async (fruit) => {
  try {
    if (!isCurrentUserAdmin) {
      return showMessage('沒有權限還原水果。');
    }

    if (!groupInviteCode) {
      return showMessage('沒有此群組。');
    }

    const oldHiddenGroups = Array.isArray(fruit.hiddenForGroups)
      ? fruit.hiddenForGroups
      : [];

    const updatedHiddenGroups = oldHiddenGroups.filter(code => code !== groupInviteCode);

    await db.collection('fruits').update(fruit.id, {
      name: fruit.name || '',
      seasons: Array.isArray(fruit.seasons) ? fruit.seasons : [],
      createdByEmail: fruit.createdByEmail || '',
      createdByNickname: fruit.createdByNickname || '',
      familyGroupName: fruit.familyGroupName || '',
      groupCode: fruit.groupCode || '',
      isPublic: fruit.isPublic || false,
      requestedPublic: fruit.requestedPublic || false,
      publishStatus: fruit.publishStatus || (fruit.isPublic ? 'approved' : 'private'),
      hiddenForGroups: updatedHiddenGroups,
      createdAt: fruit.createdAt || new Date(),
      updatedAt: new Date()
    });

    setFruits(prev =>
      prev.map(item =>
        item.id === fruit.id
          ? { ...item, hiddenForGroups: updatedHiddenGroups }
          : item
      )
    );
  } catch (error) {
    console.log('handleAdminRestoreHiddenFruit error:', error);
    showMessage('還原失敗', error.message || String(error));
  }
};

const handleAddFruit = async () => {
  try {
    if (!newFruitName || !newFruitName.trim()) {
      return showMessage('請輸入水果名稱');
    }


    const fruitData = {
      name: newFruitName.trim(),
      seasons: newFruitSeasons,

      createdByEmail: email,
      createdByNickname: nickname || '',

      familyGroupName: familyGroupName || '',
      groupCode: groupInviteCode || '',

      isPublic: false,
      requestedPublic: newFruitIsPublic,
      publishStatus: newFruitIsPublic ? 'pending' : 'private',

      hiddenForGroups: [],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await db.collection('fruits').add(fruitData);

    const localFruit = {
      id: result.name ? result.name.split('/').pop() : Date.now().toString(),
      ...fruitData
    };

    setFruits(prev => [localFruit, ...prev]);

    setNewFruitName('');
    setNewFruitSeasons([]);
    setNewFruitIsPublic(false);
    setHomeSubPage('fruits');
    setCurrentTab('home');
  } catch (error) {
    console.log('handleAddFruit error:', error);
    showMessage('儲存水果失敗', error.message || String(error));
  }
};
// 用途：admin 在家庭菜餚庫編輯模式下，隱藏單一菜式
// 注意：這裡是「從目前群組隱藏」，不是刪除 Firebase 菜式
const handleAdminRemoveDishFromGroup = async (dish) => {
  try {
    if (!isCurrentUserAdmin) {
      return showMessage('沒有權限管理家庭菜餚庫。');
    }

    if (!groupInviteCode) {
      return showMessage('沒有此群組。');
    }

    if (!dish?.id) {
      return showMessage(
        '錯誤',
        '沒有此菜式。'
      );
    }

    const oldHiddenGroups = Array.isArray(dish.hiddenForGroups)
      ? dish.hiddenForGroups
      : [];

    const updatedHiddenGroups = oldHiddenGroups.includes(groupInviteCode)
      ? oldHiddenGroups
      : [...oldHiddenGroups, groupInviteCode];

    await db.collection('dishes').update(dish.id, {
      name: dish.name || '',
      ingredients: dish.ingredients || '',
      tags: Array.isArray(dish.tags) ? dish.tags : [],

      createdByEmail: dish.createdByEmail || '',
      createdByNickname: dish.createdByNickname || '',

      familyGroupName: dish.familyGroupName || '',
      groupCode: dish.groupCode || '',

      isPublic: dish.isPublic || false,
      requestedPublic: dish.requestedPublic || false,
      publishStatus: dish.publishStatus || (dish.isPublic ? 'approved' : 'private'),

      // 保留 seed 資料，避免之後重複匯入判斷失效
      seedKey: dish.seedKey || '',
      seedSource: dish.seedSource || '',

      // 重要：把目前群組加入隱藏名單
      hiddenForGroups: updatedHiddenGroups,

      createdAt: dish.createdAt || new Date(),
      updatedAt: new Date()
    });

    // 更新本機 dishes，令畫面即時消失
    setDishes(prev =>
      prev.map(d =>
        d.id === dish.id
          ? { ...d, hiddenForGroups: updatedHiddenGroups }
          : d
      )
    );

    // 如果這道菜本來有被勾選，隱藏後順手從勾選名單移除
    setSelectedDishIdsForHide(prev =>
      prev.filter(id => id !== dish.id)
    );
  } catch (error) {
    console.log('handleAdminRemoveDishFromGroup error:', error);
    showMessage('操作失敗', error.message || String(error));
  }
};
// 用途：判斷這道菜是否可以被目前用戶永久刪除
// 只有「自己建立」+「屬於目前群組」+「不是 approved 公開菜式」才可永久刪除
const canPermanentlyDeleteDishFromGroup = (dish) => {
  if (!dish) return false;

  const status = String(
    dish.publishStatus ?? (dish.isPublic ? 'approved' : 'private')
  ).trim().toLowerCase();

  const isCreatedByMe = dish.createdByEmail === email;
  const isFromCurrentGroup = dish.groupCode === groupInviteCode;

  // approved 公開菜式不永久刪，只能從目前群組隱藏
  const isApprovedPublic = status === 'approved' || dish.isPublic === true;

  return isCreatedByMe && isFromCurrentGroup && !isApprovedPublic;
};

// 用途：批量為已選菜式加入 / 移除本群組可見標籤
const handleApplyBulkDishTags = async () => {
  try {
    if (!isCurrentUserAdmin) {
      return showMessage('只有管理員可以批量修改菜式標籤。');
    }

    if (!groupInviteCode || !currentGroupDocId) {
      return showMessage('找不到目前家庭群組。');
    }

    if (selectedDishIdsForHide.length === 0) {
      return showMessage('請先勾選要修改標籤的菜式。');
    }

    if (bulkAddDishTags.length === 0 && bulkRemoveDishTags.length === 0) {
      return showMessage('請先選擇要加入或移除的標籤。');
    }

    const targetDishes = (editableDisplayedDishes || []).filter(dish =>
      selectedDishIdsForHide.includes(dish.id)
    );

    if (targetDishes.length === 0) {
      return showMessage('已選菜式不存在。');
    }

    const overridePath = `familyGroups/${currentGroupDocId}/dishTagOverrides`;
    const nextOverrideMap = { ...dishTagOverrides };

    for (const dish of targetDishes) {
      if (!dish?.id) continue;

      const baseTags = Array.isArray(dish.tags) ? dish.tags : [];
      const currentVisibleTags = getDishVisibleTags(dish);

      // 先由目前可見 tags 開始
      let nextVisibleTags = [...currentVisibleTags];

      // 加入 tags
      bulkAddDishTags.forEach(tag => {
        if (tag && !nextVisibleTags.includes(tag)) {
          nextVisibleTags.push(tag);
        }
      });

      // 移除 tags
      nextVisibleTags = nextVisibleTags.filter(
        tag => !bulkRemoveDishTags.includes(tag)
      );

      // 重新計算相對於原始 dish.tags 的 added / removed
      const nextAddedTags = nextVisibleTags.filter(
        tag => !baseTags.includes(tag)
      );

      const nextRemovedTags = baseTags.filter(
        tag => !nextVisibleTags.includes(tag)
      );

      const overrideData = {
        dishId: dish.id,
        groupCode: groupInviteCode || '',

        addedTags: nextAddedTags,
        removedTags: nextRemovedTags,

        updatedByEmail: email || '',
        updatedByNickname: nickname || '',
        updatedAt: new Date()
      };

      await db
        .collection(overridePath)
        .set(dish.id, overrideData);

      nextOverrideMap[dish.id] = {
        id: dish.id,
        ...overrideData
      };
    }

    setDishTagOverrides(nextOverrideMap);

    setBulkAddDishTags([]);
    setBulkRemoveDishTags([]);
    setBulkDishTagModalVisible(false);

    showMessage(`已更新 ${targetDishes.length} 個菜式的本群組標籤。`);
  } catch (error) {
    console.log('handleApplyBulkDishTags error:', error);
    showMessage('批量修改標籤失敗', error.message || String(error));
  }
};
// 用途：admin 一鍵處理多個已選菜式
// 自己新增到目前群組的私房 / 待審菜式：永久刪除
// 公開菜式 / 別人建立的菜式：只從目前群組隱藏
const handleAdminHideSelectedDishes = async () => {
  try {
    if (!isCurrentUserAdmin) {
      return showMessage('只有管理員可以管理家庭菜餚庫。');
    }

    if (!groupInviteCode) {
      return showMessage('沒有此群組。');
    }

    if (selectedDishIdsForHide.length === 0) {
      return showMessage('請先勾選要處理的菜式。');
    }

    const targetDishes = (editableDisplayedDishes || []).filter(dish =>
      selectedDishIdsForHide.includes(dish.id)
    );

    if (targetDishes.length === 0) {
      return showMessage('已選菜式不存在。');
    }

    let deletedCount = 0;
    let hiddenCount = 0;

    const deletedDishIds = [];
    const hiddenDishUpdates = [];

    for (const dish of targetDishes) {
      if (!dish?.id) continue;

  
      // A. 自己新增到目前群組的非公開菜式：永久刪除
  
      if (canPermanentlyDeleteDishFromGroup(dish)) {
        await db.collection('dishes').delete(dish.id);

        deletedDishIds.push(dish.id);
        deletedCount += 1;
        continue;
      }

  
      // B. 其他菜式：只從目前群組隱藏
  
      const oldHiddenGroups = Array.isArray(dish.hiddenForGroups)
        ? dish.hiddenForGroups
        : [];

      const updatedHiddenGroups = oldHiddenGroups.includes(groupInviteCode)
        ? oldHiddenGroups
        : [...oldHiddenGroups, groupInviteCode];

      await db.collection('dishes').update(dish.id, {
        name: dish.name || '',
        ingredients: dish.ingredients || '',
        tags: Array.isArray(dish.tags) ? dish.tags : [],

        createdByEmail: dish.createdByEmail || '',
        createdByNickname: dish.createdByNickname || '',

        familyGroupName: dish.familyGroupName || '',
        groupCode: dish.groupCode || '',

        isPublic: dish.isPublic || false,
        requestedPublic: dish.requestedPublic || false,
        publishStatus: dish.publishStatus || (dish.isPublic ? 'approved' : 'private'),

        seedKey: dish.seedKey || '',
        seedSource: dish.seedSource || '',

        hiddenForGroups: updatedHiddenGroups,

        createdAt: dish.createdAt || new Date(),
        updatedAt: new Date()
      });

      hiddenDishUpdates.push({
        id: dish.id,
        hiddenForGroups: updatedHiddenGroups
      });

      hiddenCount += 1;
    }


    // 更新本機 dishes

    setDishes(prev =>
      prev
        // 永久刪除的菜式，直接從本機移除
        .filter(dish => !deletedDishIds.includes(dish.id))
        // 被隱藏的菜式，更新 hiddenForGroups
        .map(dish => {
          const update = hiddenDishUpdates.find(item => item.id === dish.id);

          if (!update) return dish;

          return {
            ...dish,
            hiddenForGroups: update.hiddenForGroups
          };
        })
    );

    setSelectedDishIdsForHide([]);

  } catch (error) {
    console.log('handleAdminHideSelectedDishes error:', error);
    showMessage('操作失敗', error.message || String(error));
  }
};
// 用途：admin 還原目前群組已隱藏的菜式
const handleAdminRestoreHiddenDish = async (dish) => {
  try {
    if (!isCurrentUserAdmin) {
      return showMessage('沒有權限還原菜式。');
    }

    if (!groupInviteCode) {
      return showMessage('沒有此群組。');
    }

    const oldHiddenGroups = Array.isArray(dish.hiddenForGroups)
      ? dish.hiddenForGroups
      : [];

    const updatedHiddenGroups = oldHiddenGroups.filter(code => code !== groupInviteCode);

    await db.collection('dishes').update(dish.id, {
      name: dish.name || '',
      ingredients: dish.ingredients || '',
      tags: dish.tags || [],
      createdByEmail: dish.createdByEmail || '',
      createdByNickname: dish.createdByNickname || '',
      familyGroupName: dish.familyGroupName || '',
      groupCode: dish.groupCode || '',
      isPublic: dish.isPublic || false,
      requestedPublic: dish.requestedPublic || false,
      publishStatus: dish.publishStatus || (dish.isPublic ? 'approved' : 'private'),
      hiddenForGroups: updatedHiddenGroups,
      createdAt: dish.createdAt || new Date()
    });

    // 更新本機 dishes，令畫面即時還原
    setDishes(prev =>
      prev.map(d =>
        d.id === dish.id
          ? { ...d, hiddenForGroups: updatedHiddenGroups }
          : d
      )
    );

    return 
      } catch (error) {
    console.log('handleAdminRestoreHiddenDish error:', error);
    showMessage('還原失敗', error.message || String(error));
  }
};


const handleAddDish = async () => {
  try {
    console.log('按了確認儲存食譜');

    if (!newDishName || !newDishName.trim()) {
      return showMessage('請輸入菜名');
    }

    const finalTags =
      addPageSelectedTags.length > 0
        ? addPageSelectedTags
        : ['⏱️ 快手菜'];

    const dishData = {
      name: newDishName.trim(),
      ingredients: newDishIngredients ? newDishIngredients.trim() : '未填寫',
      tags: finalTags,

      createdByEmail: email,
      createdByNickname: nickname || '',

      familyGroupName: familyGroupName || '',
      groupCode: groupInviteCode || '',

      isPublic: false,
      requestedPublic: isPublic,
      publishStatus: isPublic ? 'pending' : 'private',
      hiddenForGroups: [],
      createdAt: new Date()
    };

    console.log('準備儲存 dishData:', dishData);

    const result = await db.collection('dishes').add(dishData);

    // ✅ 立即同步到本地 state，首頁即時見到
    const localDish = {
      id: result.name ? result.name.split('/').pop() : Date.now().toString(),
      ...dishData
    };

    setDishes(prev => [localDish, ...prev]);

 
    setNewDishName('');
    setNewDishIngredients('');
    setAddPageSelectedTags([]);
    setIsPublic(false);
    setCurrentTab('home');

  } catch (error) {
    console.log('handleAddDish error:', error);
    showMessage('儲存失敗', error.message || String(error));
  }
};

const handleCellPress = (day) => {
  if (!day) return;

  const clickedDate = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  // 用途：找出這一天所有已確認或已完成的排餐
  // approved = 未完成但已同意
  // completed = 已完成
const mealRecords = (uniqueRequests || []).filter(r =>
  r.requestType !== 'fruit' &&
  normalizeDateString(r.date) === clickedDate &&
  (r.status === 'approved' || r.status === 'completed')
);

  // 如果這天有排餐紀錄，即使是過去日期，都可以查看
  if (mealRecords.length > 0) {
    showMessage(
      `📅 ${clickedDate} 排餐紀錄`,
      mealRecords
        .map(r => {
          const cooks = Array.isArray(r.mergedCooks)
            ? r.mergedCooks.join('、')
            : (r.targetCookName || r.target || '未知');

          const statusText =
            r.status === 'completed'
              ? '✅ 已完成'
              : '🟢 未完成';

          return r.requestType === 'fruit'
  ? `• ${statusText}｜[${r.meal}] 🍎 ${r.fruitName || r.dishName} (${cooks} 通知對象)`
  : `• ${statusText}｜[${r.meal}] ${r.dishName} (${cooks} 掌廚)`;
        })
        .join('\n')
    );

    return;
  }

  // 沒有排餐紀錄，而且日期已過，才阻止
  if (isPastDate(clickedDate)) {
    return showMessage('已過去的日子不能再排餐或修改。');
  }

  // 未來日期且沒有排餐，才問是否去點菜
showConfirmMessage(
  `📅 ${clickedDate} 目前尚無確認排餐！`,
  '要現在去挑選菜餚提出建議嗎？',
  [
    { text: '先不用', style: 'cancel' },
    {
      text: '去點菜',
      onPress: () => {
        setCustomDateInput(clickedDate);
        setCurrentTab('home');
      }
    }
  ]
);
};
// 用途：分頁 3 特別通知月曆點擊
// 有通知：過去 / 今日 / 未來都可以查看
// 無通知：過去只提示無紀錄；今日 / 未來跳去新增通知
const handleSpecialNoticeCellPress = (day) => {
  if (!day) return;

  const clickedDate = `${specialNoticeYear}-${String(specialNoticeMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  const noticesOnDate = getSpecialNotificationsByDate(clickedDate);
  const safeNoticesOnDate = Array.isArray(noticesOnDate)
    ? noticesOnDate
    : [];

  if (safeNoticesOnDate.length > 0) {
  const mergedNoticesOnDate = mergeSpecialNotificationsByPersonDate(
    safeNoticesOnDate
  );

  showMessage(
    `${clickedDate} 特別通知`,
    mergedNoticesOnDate
      .map(item => {
        return `• ${item.senderNickname || item.senderEmail || '未知'}：${getMergedSpecialNoticeDisplayText(item)}`;
      })
      .join('\n')
  );

  return;
}

  if (isPastDate(clickedDate)) {
    return showMessage('該日未有特別通知紀錄。');
  }

  setSpecialNoticeDateInput(clickedDate);
  setSpecialNoticeTypes([]);
  setSpecialNoticeOtherText('');
  setSpecialNoticeSubPage('create');
};
const renderSubTabButton = (label, isActive, onPress) => {
  return (
    <TouchableOpacity
      style={[
        styles.subTabButton,
        isActive && styles.subTabButtonActive
      ]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <Text
        style={[
          styles.subTabButtonText,
          isActive && styles.subTabButtonTextActive
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
};
//
const renderTagButtons = (tags, currentSelected, onToggle) => {
  const safeTags = Array.isArray(tags) ? tags : [];
  const safeSelected = Array.isArray(currentSelected) ? currentSelected : [];

  return safeTags.map(tag => {
    const isSelected = safeSelected.includes(tag);

    return (
      <TouchableOpacity
        key={tag}
        style={[styles.tagButtonBig, isSelected && styles.tagButtonSelected]}
        onPress={() => onToggle(tag)}
      >
        <Text style={[styles.tagTextBig, isSelected && { color: '#fff' }]}>
          {tag}
        </Text>
      </TouchableOpacity>
    );
  });
};


//
  const addToShoppingList = (ingredientsString) => {
    if (!ingredientsString || ingredientsString === '未填寫') return;
    const items = ingredientsString.split(/、|,|，/).map(item => item.trim()).filter(i => i !== "");
    const newItems = items.map(name => ({ id: Date.now().toString() + Math.random(), name, checked: false }));
    setShoppingList(prev => [...prev, ...newItems]);
  };


  const handleManualAddShopping = () => {
    if (!manualIngredientInput.trim()) return;
    setShoppingList(prev => [...prev, { id: Date.now().toString(), name: manualIngredientInput.trim(), checked: false }]);
    setManualIngredientInput('');
 
  };


  const toggleShoppingItem = (id) => {
    setShoppingList(prev => prev.map(item => item.id === id ? { ...item, checked: !item.checked } : item));
  };


  const deleteShoppingItem = (id) => {
    setShoppingList(prev => prev.filter(item => item.id !== id));
  };  

// ================= 各種 頁面 =================


// 用途：App 開啟時先檢查是否有已儲存登入；未檢查完之前先不顯示 login
if (isCheckingSavedLogin) {
  return null;
}

// 1. 登入頁面
if (appStage === 'login') {
  return (
    <View style={styles.authScreen}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFF8F0" />

<ScrollView
  style={styles.content}
  keyboardShouldPersistTaps="handled"
  contentContainerStyle={{
  paddingBottom: 100 + Math.max(insets.bottom, 16)
}}
>
    
        {/* 標題 */}
        <View style={styles.authTitleArea}>
          <Text style={styles.sectionTitleLarge}>🍲 今晚食乜餸</Text>
        </View>

        {/* 卡片 */}
        <View style={styles.searchSectionCard}>
          <Text style={styles.sectionTitleSmall}>🔐 帳號登入</Text>

          {/* 電郵 */}
          <Text style={styles.label}>電郵</Text>
          <TextInput
            style={styles.input}
            placeholderTextColor="#B8A89A"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />

          {/* 密碼 */}
          <Text style={styles.label}>密碼</Text>
          <TextInput
            style={styles.input}
            placeholderTextColor="#B8A89A"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />

          {/* 登入 */}
          <TouchableOpacity
            style={styles.mainActionBtn}
            onPress={handleLogin}
          >
            <Text style={styles.mainActionText}>登入</Text>
          </TouchableOpacity>

          {/* 切換去註冊 */}
          <TouchableOpacity
            style={styles.switchStageLink}
            onPress={() => setAppStage('register')}
          >
            
<Text style={styles.switchStageText}>
  還沒有帳號？立即
  <Text style={styles.switchToRegisterText}>註冊</Text>
</Text>

          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

// 2. 註冊頁面
if (appStage === 'register') {
  return (
    <View style={styles.authScreen}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFF8F0" />

      <ScrollView
  style={styles.content}
  keyboardShouldPersistTaps="handled"
contentContainerStyle={{
  paddingBottom: 100 + Math.max(insets.bottom, 16)
}}
>
        {/* 標題 */}
        <View style={styles.authTitleArea}>
          <Text style={styles.sectionTitle}>📝 建立新帳號</Text>
        </View>

        {/* 卡片 */}
        <View style={styles.searchSectionCard}>
         
          {/* 暱稱 */}
          <Text style={styles.label}>暱稱 *</Text>
          <TextInput
            style={styles.input}
            placeholderTextColor="#B8A89A"
            value={nickname}
            onChangeText={setNickname}
          />

          {/* 電郵 */}
          <Text style={styles.label}>電郵 *</Text>
          <TextInput
            style={styles.input}
            placeholderTextColor="#B8A89A"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />

          {/* 密碼 */}
          <Text style={styles.label}>密碼 *</Text>
          <TextInput
            style={styles.input}
            placeholderTextColor="#B8A89A"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />

          {/* 確認密碼 */}
          <Text style={styles.label}>確認密碼 *</Text>
          <TextInput
            style={styles.input}
            placeholderTextColor="#B8A89A"
            secureTextEntry
            value={confirmPassword}
            onChangeText={setConfirmPassword}
          />

          {/* 註冊按鈕 */}
          <TouchableOpacity
            style={styles.mainActionBtnAlt}
            onPress={handleRegister}
          >
            <Text style={styles.mainActionText}>註冊</Text>
          </TouchableOpacity>

          {/* 返回登入 */}
          <TouchableOpacity
            style={styles.switchStageLink}
            onPress={() => setAppStage('login')}
          >
            <Text style={styles.switchStageText}>
  已有帳號？返回
  <Text style={styles.switchToLoginText}>登入</Text>
</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}



// 3. 群組設定頁面
if (appStage === 'group_setup') {
  return (
    <View style={styles.authScreen}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFF8F0" />

<ScrollView
  style={styles.content}
  keyboardShouldPersistTaps="handled"
contentContainerStyle={{
  paddingBottom: 100 + Math.max(insets.bottom, 16)
}}
>
        <View style={styles.authTitleArea}>
          <Text style={styles.sectionTitleLarge}>🏠 建立家庭群組</Text>
        </View>

        <View style={styles.setupCard}>
          <Text style={styles.cardTitle}>1. 選擇您的初始角色</Text>

          <View style={styles.roleRow}>
            <TouchableOpacity
              style={[
                styles.roleSelectBtn,
                userRole === 'eat' && styles.roleSelectBtnActive
              ]}
              onPress={() => setUserRole('eat')}
            >
              <Text style={styles.roleBtnText}>🐷 負責吃</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.roleSelectBtn,
                userRole === 'cook' && styles.roleSelectBtnActive
              ]}
              onPress={() => setUserRole('cook')}
            >
              <Text style={styles.roleBtnText}>🍳 負責做飯</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.setupCard}>
          <Text style={styles.cardTitle}>選項 A：新開群組</Text>

          <TouchableOpacity
            style={styles.primaryButton}
            onPress={handleCreateFamilyGroup}
          >
            <Text style={styles.buttonText}>🔑 建立群組</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.setupCard}>
          <Text style={styles.cardTitle}>選項 B：加入現有群組</Text>

          <TextInput
            style={styles.input}
            placeholder="輸入家人邀請碼"
            placeholderTextColor="#B8A89A"
            value={inputInviteCode}
            onChangeText={setInputInviteCode}
            autoCapitalize="characters"
          />

          <TouchableOpacity
            style={styles.primaryButton}
            onPress={handleSwitchOrJoinGroup}
          >
            <Text style={styles.buttonText}>🔑 加入群組</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

return (
  <SafeAreaView
    style={styles.safeRoot}
    edges={['top', 'left', 'right']}
  >
    <StatusBar
      barStyle="dark-content"
      backgroundColor="#FFF8F0"
      translucent={false}
    />

    <View style={styles.container}>
      <ScrollView
  style={styles.content}
  keyboardShouldPersistTaps="handled"
  contentContainerStyle={{
    paddingBottom: 100 + Math.max(insets.bottom, 16)
  }}
  onScroll={(e) => {
    const y = e.nativeEvent.contentOffset.y;

    if (y > 500) {
      setShowScrollTopBtn(true);
    } else {
      setShowScrollTopBtn(false);
    }
  }}
  scrollEventThrottle={16}
  ref={scrollViewRef}
>
      {/* 頁面頂部 header：跟內容一起捲動，不固定置頂 */}
      <View style={styles.header}>
        <View style={styles.headerInner}>
          <Text
            style={styles.headerTitle}
            numberOfLines={1}
          >
            {familyGroupName || '今晚食乜餸'} 🍲
          </Text>
        </View>
      </View>

{/* ================= 分頁 1: 首頁 ================= */}
{currentTab === 'home' && (
  <View style={styles.pageContent}>
    {/* 內部分頁切換：菜式 / 水果 */}
 <View style={styles.subTabContainer}>
  {renderSubTabButton(
    '菜式庫',
    homeSubPage === 'dishes',
    () => {
      setHomeSubPage('dishes');
      setIsFruitEditMode(false);
      setSelectedFruitIdsForHide([]);
    }
  )}

  {renderSubTabButton(
    '水果庫',
    homeSubPage === 'fruits',
    () => {
      setHomeSubPage('fruits');
      setIsDishEditMode(false);
      setSelectedDishIdsForHide([]);
    }
  )}
</View>
{/* 收到點菜 / 水果要求提示：加強版大按鈕 */}
{incomingRequests.length > 0 && (
  <TouchableOpacity
    activeOpacity={0.85}
    style={styles.requestInboxBigButton}
    onPress={() => {
  setRequestInboxVisible(false);
  setTimeout(() => {
    setRequestInboxVisible(true);
  }, 50);
}}

  >
    <View style={styles.requestInboxBigButtonLeft}>
      <Text style={styles.requestInboxBigIcon}>📨</Text>

      <View>
        <Text style={styles.requestInboxBigTitle}>
          有 {incomingRequests.length} 個要求等緊處理
        </Text>


      </View>
    </View>

 </TouchableOpacity>
)}


    {/* ================= 菜式專頁 ================= */}
    {homeSubPage === 'dishes' && (
      <>
 

        {/* 篩選與搜尋 */}
        <View style={styles.searchSectionCard}>
          <Text style={styles.sectionTitleSmall}>🔍 搜尋菜式</Text>

          <TextInput
            style={styles.input}
            placeholderTextColor="#B8A89A"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />

<View style={styles.toolbarRow}>
  <TouchableOpacity
    style={[
      styles.smallActionButton,
      styles.neutralActionButton,
      { marginRight: 8 }
    ]}
    onPress={() => setSelectedTags([])}
  >
    <Text style={styles.smallActionButtonText}>
      🧹 清空選取 ({selectedTags.length})
    </Text>
  </TouchableOpacity>

  <TouchableOpacity
    style={[styles.smallActionButton, styles.infoActionButton]}
    onPress={() => setCustomModalVisible(true)}
  >
    <Text style={styles.smallActionButtonText}>
      ⚙️ 管理標籤
    </Text>
  </TouchableOpacity>
</View>

{/* 新增菜式：由分頁 3 合併入菜式庫，用 Modal 開啟 */}
<TouchableOpacity
  activeOpacity={0.85}
  style={styles.addRecipeFullButton}
  onPress={() => {
    setAddDishModalVisible(true);
  }}
>
  <Text style={styles.addRecipeFullButtonText}>
    ➕ 新增菜式
  </Text>
</TouchableOpacity>

          {/* 分類 / 標籤 */}
          {getSortedCategoryKeys().map(key => {
            const category = dynamicCategories[key];
            const isExpanded = expandedCategories[key];

            return (
              <View key={key} style={styles.categoryBlock}>
                <TouchableOpacity
                  style={styles.accordionHeader}
                  onPress={() => toggleCategoryExpand(key)}
                >
                  <Text style={styles.categoryLabel}>{category.title}</Text>

                  <Text style={styles.searchHintText}>
                    {isExpanded ? '🔼 收起' : '🔍 展開'}
                  </Text>
                </TouchableOpacity>

                {isExpanded && (
                  <View style={styles.categoryContent}>
                    {category.isNested ? (
                      getSortedSubCategoryKeys(key).map(subKey => (
                        <View key={subKey} style={styles.subCategoryBlock}>
                          <Text style={styles.subCategoryLabel}>
                            └ {category.subCategories[subKey].title}
                          </Text>

                          <View style={styles.tagContainer}>
                            {renderTagButtons(
                              getSortedTags(
                                category.subCategories[subKey].tags,
                                key,
                                subKey
                              ),
                              selectedTags,
                              (tag) => {
                                setSelectedTags(prev =>
                                  prev.includes(tag)
                                    ? prev.filter(t => t !== tag)
                                    : [...prev, tag]
                                );
                              }
                            )}
                          </View>
                        </View>
                      ))
                    ) : (
                      <View style={styles.tagContainer}>
                        {renderTagButtons(
                          getSortedTags(category.tags, key),
                          selectedTags,
                          (tag) => {
                            setSelectedTags(prev =>
                              prev.includes(tag)
                                ? prev.filter(t => t !== tag)
                                : [...prev, tag]
                            );
                          }
                        )}
                      </View>
                    )}
                  </View>
                )}
              </View>
            );
          })}
        </View>
       {/* 隨機抽菜 */}
        <TouchableOpacity style={styles.luckyDrawButton} onPress={handleDraw}>
          <Text style={styles.luckyDrawButtonText}>
            ✨ 🔮 隨機食乜都好 🔮 ✨
          </Text>
        </TouchableOpacity>
        {/* 菜式庫標題 + 編輯按鈕 */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>
            📋 菜式庫
          </Text>

          {isCurrentUserAdmin && (
            <TouchableOpacity
              style={[
                styles.editToggleButton,
                isDishEditMode && styles.editToggleButtonActive
              ]}
              onPress={() => {
                if (isDishEditMode) {
                  setDishEditSearchQuery('');
                  setSelectedDishIdsForHide([]);
                }

                setIsDishEditMode(prev => !prev);
              }}
            >
              <Text style={styles.editToggleButtonText}>
                {isDishEditMode ? '完成' : '編輯'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* 菜式編輯模式操作區 */}
        {isDishEditMode && isCurrentUserAdmin && (
          <View style={styles.editToolbar}>
            <Text style={styles.editToolbarHint}>
              可先在上面篩選菜式標籤。
            </Text>

            <View style={styles.editToolbarButtonGroup}>
              <View style={styles.editToolbarRow}>
                <TouchableOpacity
                  style={[
                    styles.editMainActionButton,
                    selectedDishIdsForHide.length > 0
                      ? styles.dangerActionButton
                      : styles.disabledActionButton,
                    { marginRight: 8 }
                  ]}
                  disabled={selectedDishIdsForHide.length === 0}
                  onPress={handleAdminHideSelectedDishes}
                >
                  <Text style={styles.editMainActionText}>
                    🧹 一鍵處理 ({selectedDishIdsForHide.length})
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.clearSelectionButton}
                  onPress={() => setSelectedDishIdsForHide([])}
                >
                  <Text style={styles.clearSelectionText}>
                    清空
                  </Text>
                </TouchableOpacity>
              </View>
<TouchableOpacity
  style={[
    styles.bulkTagManageButton,
    selectedDishIdsForHide.length === 0 && styles.disabledActionButton
  ]}
  disabled={selectedDishIdsForHide.length === 0}
  onPress={() => {
  setBulkAddDishTags([]);
  setBulkRemoveDishTags([]);
  setBulkTagEditMode('add');
  setBulkDishTagModalVisible(true);
}}
>
  <Text style={styles.bulkTagManageButtonText}>
    🏷️ 批量修改標籤 ({selectedDishIdsForHide.length})
  </Text>
</TouchableOpacity>
              <TouchableOpacity
                style={styles.hiddenManageButton}
                onPress={() => setHiddenDishesModalVisible(true)}
              >
                <Text style={styles.hiddenManageButtonText}>
                  🙈 管理已隱藏菜式 ({(hiddenDishesForCurrentGroup || []).length})
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* 菜式庫列表 */}
        {(editableDisplayedDishes || []).map(dish => {
          const status = String(
            dish.publishStatus ?? (dish.isPublic ? 'approved' : 'private')
          ).trim().toLowerCase();

          const isSelectedForHide = selectedDishIdsForHide.includes(dish.id);

          return (
            <TouchableOpacity
              key={dish.id}
              style={[
                styles.dishCardSelectable,
                isDishEditMode &&
                  isCurrentUserAdmin &&
                  isSelectedForHide &&
                  styles.dishCardSelected
              ]}
              onPress={() => {
                if (isDishEditMode && isCurrentUserAdmin) {
                  toggleDishHideSelection(dish.id);
                  return;
                }

                openRequestModal(dish, customDateInput);
              }}
            >
              <View style={styles.dishCardRow}>
                {isDishEditMode && isCurrentUserAdmin && (
                  <View
                    style={[
                      styles.checkboxBox,
                      isSelectedForHide && styles.checkboxBoxSelected
                    ]}
                  >
                    <Text style={styles.checkboxTick}>
                      {isSelectedForHide ? '✓' : ''}
                    </Text>
                  </View>
                )}

                <View style={styles.dishCardContent}>
                  <View style={styles.dishCardHeader}>
                    <Text style={styles.dishName}>{dish.name}</Text>

                    <Text
                      style={[
                        styles.dishStatusText,
                        status === 'approved' && styles.dishStatusApproved,
                        status === 'pending' && styles.dishStatusPending,
                        status === 'private' && styles.dishStatusPrivate
                      ]}
                    >
                      {status === 'approved'
                        ? '🌐 公開'
                        : status === 'pending'
                          ? '⏳ 待確認'
                          : '🔒 私房'}
                    </Text>
                  </View>

                  <Text style={styles.dishDetails}>
  材料: {dish.ingredients} | 分類: {getDishVisibleTags(dish).join(', ')}
</Text>

                  {!isDishEditMode && (
                    <Text style={styles.clickHint}>
                      👉 我要食呢個
                    </Text>
                  )}
                </View>
              </View>
            </TouchableOpacity>
          );
        })}
      </>
    )}

    {/* ================= 水果專頁 ================= */}
    {homeSubPage === 'fruits' && (
      <>
        {/* 搜尋水果 */}
        <View style={styles.searchSectionCard}>
          <Text style={styles.sectionTitleSmall}>🔍 搜尋水果</Text>

          <TextInput
            style={styles.input}
            placeholderTextColor="#B8A89A"
            value={fruitSearchQuery}
            onChangeText={setFruitSearchQuery}
          />
{/* 新增水果：由分頁 3 合併入水果庫，用 Modal 開啟 */}
<TouchableOpacity
  activeOpacity={0.85}
  style={styles.addRecipeFullButton}
  onPress={() => {
    setAddFruitModalVisible(true);
  }}
>
  <Text style={styles.addRecipeFullButtonText}>
    ➕ 新增水果
  </Text>
</TouchableOpacity>

<Text style={styles.categoryLabel}>🍎 季節標籤</Text>

          <View style={styles.tagContainer}>
            {renderTagButtons(
              getSortedFruitSeasons(),
              selectedFruitSeasons,
              (season) => {
                setSelectedFruitSeasons(prev =>
                  prev.includes(season)
                    ? prev.filter(item => item !== season)
                    : [...prev, season]
                );
              }
            )}
          </View>
        </View>

        {/* 水果庫標題 + 編輯按鈕 */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>
            📋 水果庫
          </Text>

          {isCurrentUserAdmin && (
            <TouchableOpacity
              style={[
                styles.editToggleButton,
                isFruitEditMode && styles.editToggleButtonActive
              ]}
              onPress={() => {
                if (isFruitEditMode) {
                  setSelectedFruitIdsForHide([]);
                }

                setIsFruitEditMode(prev => !prev);
              }}
            >
              <Text style={styles.editToggleButtonText}>
                {isFruitEditMode ? '完成' : '編輯'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* 水果編輯模式操作區 */}
        {isFruitEditMode && isCurrentUserAdmin && (
          <View style={styles.editToolbar}>
            <Text style={styles.editToolbarHint}>
              可先在上面篩選水果季節標籤。
            </Text>

            <View style={styles.editToolbarButtonGroup}>
              <View style={styles.editToolbarRow}>
                <TouchableOpacity
                  style={[
                    styles.editMainActionButton,
                    selectedFruitIdsForHide.length > 0
                      ? styles.dangerActionButton
                      : styles.disabledActionButton,
                    { marginRight: 8 }
                  ]}
                  disabled={selectedFruitIdsForHide.length === 0}
                  onPress={handleAdminHideSelectedFruits}
                >
                  <Text style={styles.editMainActionText}>
                    🧹 一鍵處理 ({selectedFruitIdsForHide.length})
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.clearSelectionButton}
                  onPress={() => setSelectedFruitIdsForHide([])}
                >
                  <Text style={styles.clearSelectionText}>
                    清空
                  </Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={styles.hiddenManageButton}
                onPress={() => setHiddenFruitsModalVisible(true)}
              >
                <Text style={styles.hiddenManageButtonText}>
                  🙈 管理已隱藏水果 ({(hiddenFruitsForCurrentGroup || []).length})
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* 水果庫列表 */}
        {(editableDisplayedFruits || []).map(fruit => {
          const status = String(
            fruit.publishStatus ?? (fruit.isPublic ? 'approved' : 'private')
          ).trim().toLowerCase();

          const isSelectedForHide = selectedFruitIdsForHide.includes(fruit.id);

          return (
            <TouchableOpacity
              key={fruit.id}
              style={[
                styles.dishCardSelectable,
                isFruitEditMode &&
                  isCurrentUserAdmin &&
                  isSelectedForHide &&
                  styles.dishCardSelected
              ]}
              onPress={() => {
                if (isFruitEditMode && isCurrentUserAdmin) {
                  toggleFruitHideSelection(fruit.id);
                  return;
                }

                openFruitRequestModal(fruit);
              }}
            >
              <View style={styles.dishCardRow}>
                {isFruitEditMode && isCurrentUserAdmin && (
                  <View
                    style={[
                      styles.checkboxBox,
                      isSelectedForHide && styles.checkboxBoxSelected
                    ]}
                  >
                    <Text style={styles.checkboxTick}>
                      {isSelectedForHide ? '✓' : ''}
                    </Text>
                  </View>
                )}

                <View style={styles.dishCardContent}>
                  <View style={styles.dishCardHeader}>
                    <Text style={styles.dishName}>
                      {getFruitEmoji(fruit.name)} {fruit.name}
                    </Text>

                    <Text
                      style={[
                        styles.dishStatusText,
                        status === 'approved' && styles.dishStatusApproved,
                        status === 'pending' && styles.dishStatusPending,
                        status === 'private' && styles.dishStatusPrivate
                      ]}
                    >
                      {status === 'approved'
                        ? '🌐 公開'
                        : status === 'pending'
                          ? '⏳ 待確認'
                          : '🔒 私房'}
                    </Text>
                  </View>

                  <Text style={styles.dishDetails}>
                    季節: {Array.isArray(fruit.seasons) ? fruit.seasons.join(', ') : ''}
                  </Text>

                  {!isFruitEditMode && (
                    <Text style={styles.clickHint}>
                      👉 想食呢個
                    </Text>
                  )}
                </View>
              </View>
            </TouchableOpacity>
          );
        })}
      </>
    )}
  </View>
)}

{/* ================= 分頁 2: 家庭動態 ================= */}
{currentTab === 'group' && (
  <View style={styles.pageContent}>
    <View style={styles.monthSwitcherRow}>
      <TouchableOpacity onPress={handlePrevMonth}>
        <Text style={styles.switchMonthText}>◀ 上個月</Text>
      </TouchableOpacity>

      <Text style={styles.monthTitle}>
        📅 {currentYear}年 {currentMonth}月
      </Text>

      <TouchableOpacity onPress={handleNextMonth}>
        <Text style={styles.switchMonthText}>下個月 ▶</Text>
      </TouchableOpacity>
    </View>

    <View style={styles.calendarContainer}>
      <View style={styles.calendarHeaderRow}>
        {['日', '一', '二', '三', '四', '五', '六'].map(w => (
          <Text key={w} style={styles.calendarHeaderCell}>
            {w}
          </Text>
        ))}
      </View>

      <View style={styles.calendarGrid}>
        {calendarCells.map((day, index) => {
          if (day === null) {
            return (
              <View
                key={`empty-${index}`}
                style={styles.calendarCellEmpty}
              />
            );
          }

          const thisDateStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

          const isToday =
            currentYear === CURRENT_DATE.getFullYear() &&
            currentMonth === (CURRENT_DATE.getMonth() + 1) &&
            day === CURRENT_DATE.getDate();

          const hasApprovedEvent = approvedDates.includes(thisDateStr);
          const hasCompletedEvent = completedDates.includes(thisDateStr);
          const hasEvent = hasApprovedEvent || hasCompletedEvent;
          const isPast = isPastDate(thisDateStr);

          const cellContent = (
            <>
              <Text
                style={[
                  styles.calendarDayNum,
                  hasEvent && styles.calendarDayNumHasEvent,
                  isToday && !hasEvent && styles.calendarDayNumToday,
                  isPast && !hasEvent && styles.calendarDayNumPast
                ]}
              >
                {day}
              </Text>

              {hasApprovedEvent && (
                <View style={styles.calendarDotWhite} />
              )}

              {hasCompletedEvent && (
                <View style={styles.calendarDotWhite} />
              )}
            </>
          );

          if (isPast && !hasEvent) {
            return (
              <View
                key={`day-${day}`}
                style={[
                  styles.calendarCell,
                  styles.calendarCellPast
                ]}
              >
                {cellContent}
              </View>
            );
          }

          return (
            <TouchableOpacity
              key={`day-${day}`}
              style={[
                styles.calendarCell,
                isToday && styles.calendarCellToday,
                hasApprovedEvent && styles.calendarCellApproved,
                hasCompletedEvent && styles.calendarCellCompleted
              ]}
              onPress={() => handleCellPress(day)}
            >
              {cellContent}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>

    <Text style={styles.sectionTitle}>
      💬 排餐記錄 👇
    </Text>

 <View style={styles.subTabContainer}>
  {renderSubTabButton(
    '全部',
    requestTypeFilter === 'all',
    () => setRequestTypeFilter('all')
  )}

  {renderSubTabButton(
    '菜式',
    requestTypeFilter === 'dish',
    () => setRequestTypeFilter('dish')
  )}

  {renderSubTabButton(
    '水果',
    requestTypeFilter === 'fruit',
    () => setRequestTypeFilter('fruit')
  )}
</View>

    {(sortedRequests || []).map(req => {
const requestIds = Array.isArray(req.mergedRequestIds)
  ? req.mergedRequestIds
  : [req.id];

const relatedOriginalRequests = (requests || []).filter(originalReq =>
  requestIds.includes(originalReq.id)
);

const canCurrentUserReview =
  req.requestType === 'fruit'
    ? relatedOriginalRequests.some(originalReq =>
        originalReq.targetPersonEmail === email ||
        originalReq.targetCookEmail === email
      )
    : (
        Array.isArray(req.mergedCookEmails)
          ? req.mergedCookEmails.includes(email)
          : req.targetCookEmail === email
      );

      const displaySenders = Array.isArray(req.mergedSenders)
        ? req.mergedSenders.join('、')
        : (req.senderNickname || req.sender || '未知');

      const displayCooks = Array.isArray(req.mergedCooks)
        ? req.mergedCooks.join('、')
        : (req.targetCookName || req.target || '未知');


      return (
        <View key={req.id} style={styles.requestCard}>
          <View style={styles.requestCardHeader}>
            <Text style={styles.dishName}>
              {req.requestType === 'fruit'
                ? `${getFruitEmoji(req.fruitName || req.dishName)} ${req.fruitName || req.dishName}`
                : `🍽️ ${req.dishName}`}
            </Text>

<Text
  style={[
    styles.statusBadge,
    req.status === 'approved' && styles.statusBadgeApproved,
    req.status === 'rejected' && styles.statusBadgeRejected,
    req.status === 'pending' && styles.statusBadgePending
  ]}
>
  {req.requestType === 'fruit' && req.status === 'approved'
    ? '✅ 已安排'
    : getStatusLabel(req.status)}
</Text>
          </View>

          <Text style={styles.requestMetaText}>
            發起成員：🙋‍♂️{' '}
            <Text style={styles.requestMetaStrong}>
              {displaySenders}
            </Text>
          </Text>

          {req.requestType !== 'fruit' && (
            <Text style={styles.requestMetaText}>
              日期餐次：
              <Text style={styles.timeHighlight}>
                {req.date} ({req.meal})
              </Text>
            </Text>
          )}

          <Text style={styles.requestMetaTextBottom}>
            {req.requestType === 'fruit' ? '通知對象：👤 ' : '掌廚大廚：👨‍🍳 '}
            <Text style={styles.requestMetaStrong}>
              {displayCooks}
            </Text>
          </Text>

{(
  // 菜式：pending / approved 都可以在排餐記錄操作
  req.requestType !== 'fruit' &&
  (req.status === 'pending' || req.status === 'approved') &&
  canCurrentUserReview
) || (
  // 水果：只有 approved 後，通知對象才可以在排餐記錄取消 / 已完成
  req.requestType === 'fruit' &&
  req.status === 'approved' &&
  canCurrentUserReview
) ? (
  <View style={styles.actionRow}>
    {/* 菜式 pending：同意 */}
    {req.requestType !== 'fruit' && req.status === 'pending' && (
      <TouchableOpacity
        style={[styles.actionBtn, styles.successActionButton]}
        onPress={() => handleApproveRequest(requestIds)}
      >
        <Text style={styles.actionBtnText}>👍 同意</Text>
      </TouchableOpacity>
    )}

    {/* 菜式 pending / approved：改期 */}
    {req.requestType !== 'fruit' && (
      <TouchableOpacity
        style={[styles.actionBtn, styles.infoActionButton]}
        disabled={rescheduleModalVisible}
        onPress={() => openRescheduleModal(req)}
      >
        <Text style={styles.actionBtnText}>📅 改期</Text>
      </TouchableOpacity>
    )}

    {/* 菜式 pending = 拒絕；菜式 approved = 取消；水果 approved = 取消 */}
    <TouchableOpacity
      style={[styles.actionBtn, styles.dangerActionButton]}
      onPress={() => openRejectModal(req)}
    >
      <Text style={styles.actionBtnText}>
        {req.requestType === 'fruit'
          ? '👎 取消'
          : req.status === 'approved'
            ? '👎 取消'
            : '👎 拒絕'}
      </Text>
    </TouchableOpacity>

    {/* approved 後可以已完成：菜式 / 水果都可以 */}
    {req.status === 'approved' && (
      <TouchableOpacity
        style={[styles.actionBtn, styles.neutralActionButton]}
        onPress={() => handleCompleteRequest(requestIds)}
      >
        <Text style={styles.actionBtnText}>✅ 已完成</Text>
      </TouchableOpacity>
    )}
  </View>
) : null}
        </View>
      );
    })}
  </View>
)}

{/* ================= 分頁 3: 特別通知 ================= */}
{currentTab === 'add' && (
  <View style={styles.pageContent}>
    <View style={styles.subTabContainer}>
      {renderSubTabButton(
        '📅 通知總覽',
        specialNoticeSubPage === 'overview',
        () => setSpecialNoticeSubPage('overview')
      )}

      {renderSubTabButton(
        '➕ 新通知',
        specialNoticeSubPage === 'create',
        () => {
          setSpecialNoticeDateInput(formatDateToString(CURRENT_DATE));
          setSpecialNoticeTypes([]);
          setSpecialNoticeOtherText('');
          setSpecialNoticeSubPage('create');
        }
      )}
    </View>

    {specialNoticeSubPage === 'overview' && (
      <>
        <View style={styles.monthSwitcherRow}>
          <TouchableOpacity onPress={handlePrevSpecialNoticeMonth}>
            <Text style={styles.switchMonthText}>◀ 上個月</Text>
          </TouchableOpacity>

          <Text style={styles.monthTitle}>
            📅 {specialNoticeYear}年 {specialNoticeMonth}月
          </Text>

          <TouchableOpacity onPress={handleNextSpecialNoticeMonth}>
            <Text style={styles.switchMonthText}>下個月 ▶</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.calendarContainer}>
          <View style={styles.calendarHeaderRow}>
            {['日', '一', '二', '三', '四', '五', '六'].map(w => (
              <Text key={w} style={styles.calendarHeaderCell}>
                {w}
              </Text>
            ))}
          </View>

          <View style={styles.calendarGrid}>
            {specialNoticeCalendarCells.map((day, index) => {
              if (day === null) {
                return (
                  <View
                    key={`special-empty-${index}`}
                    style={styles.calendarCellEmpty}
                  />
                );
              }

              const thisDateStr = `${specialNoticeYear}-${String(
                specialNoticeMonth
              ).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

              const isToday =
                specialNoticeYear === CURRENT_DATE.getFullYear() &&
                specialNoticeMonth === CURRENT_DATE.getMonth() + 1 &&
                day === CURRENT_DATE.getDate();

              const isPast = isPastDate(thisDateStr);

              const noticesOnDate = getSpecialNotificationsByDate(thisDateStr);
              const safeNoticesOnDate = Array.isArray(noticesOnDate)
                ? noticesOnDate
                : [];

              const hasNotice = safeNoticesOnDate.length > 0;

              return (
                <TouchableOpacity
                  key={`special-day-${day}`}
                  style={[
                    styles.calendarCell,
                    isToday && styles.calendarCellToday,
                    hasNotice && styles.calendarCellSpecialNotice,
                    isPast && !hasNotice && styles.calendarCellPast
                  ]}
                  onPress={() => handleSpecialNoticeCellPress(day)}
                >
                  <Text
                    style={[
                      styles.calendarDayNum,
                      hasNotice && styles.calendarDayNumHasEvent,
                      isToday && !hasNotice && styles.calendarDayNumToday,
                      isPast && !hasNotice && styles.calendarDayNumPast
                    ]}
                  >
                    {day}
                  </Text>

                  {hasNotice && (
                    <View style={styles.calendarDotWhite} />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>
            🔔 特別通知
          </Text>
        </View>

        {(Array.isArray(sortedUpcomingSpecialNotificationGroups)
  ? sortedUpcomingSpecialNotificationGroups.length
  : 0) === 0 ? (
          <View style={styles.formCard}>
            <Text style={styles.emptyShoppingText}>
              暫時未有特別通知。
            </Text>

            <TouchableOpacity
              activeOpacity={0.85}
              style={styles.addRecipeFullButton}
              onPress={() => {
                setSpecialNoticeDateInput(formatDateToString(CURRENT_DATE));
                setSpecialNoticeTypes([]);
                setSpecialNoticeOtherText('');
                setSpecialNoticeSubPage('create');
              }}
            >
              <Text style={styles.addRecipeFullButtonText}>
                ➕ 新增特別通知
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          (Array.isArray(sortedUpcomingSpecialNotificationGroups)
  ? sortedUpcomingSpecialNotificationGroups
  : []
).map(notice => {
  const noticeDisplayText = getMergedSpecialNoticeDisplayText(notice);

  const canCancel = notice.senderEmail === email;

  return (

              <View key={notice.id} style={styles.requestCard}>
                <View style={styles.requestCardHeader}>
                  <Text style={styles.dishName}>
                    🙋‍♂️ {notice.senderNickname || notice.senderEmail || '未知'}
                  </Text>

                  <Text style={[styles.statusBadge, styles.statusBadgeApproved]}>
                    🔔
                  </Text>
                </View>

                <Text style={styles.requestMetaText}>
                  通知：
                  <Text style={styles.requestMetaStrong}>
                    {noticeDisplayText}
                  </Text>
                </Text>

                <Text style={styles.requestMetaTextBottom}>
                  日期：
                  <Text style={styles.timeHighlight}>
                    {normalizeDateString(notice.date || '')}
                  </Text>
                </Text>

                {canCancel && (
                  <View style={styles.actionRow}>
                    <TouchableOpacity
                      style={[styles.actionBtn, styles.dangerActionButton]}
                      onPress={() => cancelSpecialNotificationGroup(notice)}
                    >
                      <Text style={styles.actionBtnText}>
                        👎 取消通知
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            );
          })
        )}
      </>
    )}

    {specialNoticeSubPage === 'create' && (
      <View style={styles.formCard}>
        <Text style={styles.sectionTitleLarge}>
          ➕ 新增特別通知
        </Text>

        <Text style={styles.label}>通知日期：</Text>

        <TouchableOpacity
          activeOpacity={0.85}
          onPress={openSpecialNoticeCalendar}
        >
          <View style={styles.input}>
            <Text style={{ color: specialNoticeDateInput ? '#333' : '#B8A89A' }}>
              {specialNoticeDateInput || '請選擇日期'}
            </Text>
          </View>
        </TouchableOpacity>

        <Text style={styles.label}>通知類型：</Text>

        <View style={styles.specialNoticeTypeGrid}>
          {SPECIAL_NOTICE_TYPES.map(item => {
            const isSelected =
              Array.isArray(specialNoticeTypes) &&
              specialNoticeTypes.includes(item.key);

            return (
              <TouchableOpacity
                key={item.key}
                activeOpacity={0.85}
                style={[
                  styles.specialNoticeTypeButton,
                  isSelected && styles.specialNoticeTypeButtonActive
                ]}
                onPress={() => toggleSpecialNoticeType(item.key)}
              >
                <Text
                  style={[
                    styles.specialNoticeTypeText,
                    isSelected && styles.specialNoticeTypeTextActive
                  ]}
                >
                  {isSelected ? '✓ ' : ''}
                  {item.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {Array.isArray(specialNoticeTypes) &&
          specialNoticeTypes.includes('other') && (
            <>
              <Text style={styles.label}>其他通知內容：</Text>
              <TextInput
                style={styles.input}
                placeholder="例如：今晚要早點吃飯"
                placeholderTextColor="#B8A89A"
                value={specialNoticeOtherText}
                onChangeText={setSpecialNoticeOtherText}
              />
            </>
          )}

        <View style={styles.specialNoticeButtonGroup}>
          <TouchableOpacity
            activeOpacity={0.85}
            style={[
              styles.specialNoticeFullButton,
              styles.specialNoticeSubmitButton,
              isSpecialNoticeSubmitting &&
                styles.specialNoticeSubmitButtonDisabled
            ]}
            disabled={isSpecialNoticeSubmitting}
            onPress={sendSpecialNotification}
          >
            <Text style={styles.specialNoticePrimaryButtonText}>
              {isSpecialNoticeSubmitting ? '送出中...' : '📢 送出特別通知'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.85}
            style={[
              styles.specialNoticeFullButton,
              styles.specialNoticeBackButton
            ]}
            onPress={() => setSpecialNoticeSubPage('overview')}
          >
            <Text style={styles.specialNoticeBackButtonText}>
              返回通知總覽
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    )}
  </View>
)}
{/* ================= 分頁 4: 購物清單 ================= */}
{currentTab === 'shopping' && (
  <View style={styles.pageContent}>
    <View style={styles.formCard}>
      <Text style={styles.sectionTitleLarge}>🛒 購物清單</Text>

      <View style={styles.shoppingInputRow}>
        <TextInput
          style={[styles.input, styles.shoppingInput]}
          placeholderTextColor="#B8A89A"
          value={manualIngredientInput}
          onChangeText={setManualIngredientInput}
          onSubmitEditing={handleManualAddShopping}
        />

        <TouchableOpacity
          style={styles.confirmBtnReal}
          onPress={handleManualAddShopping}
        >
          <Text style={styles.confirmBtnRealText}>新增</Text>
        </TouchableOpacity>
      </View>

      {shoppingList.length === 0 ? (
        <Text style={styles.emptyShoppingText}>
          清單目前空空如也唷！
        </Text>
      ) : (
        shoppingList.map(item => (
          <View key={item.id} style={styles.shoppingItemRow}>
            <TouchableOpacity
              onPress={() => toggleShoppingItem(item.id)}
              style={styles.shoppingItemMain}
            >
              <Text
                style={[
                  styles.shoppingItemText,
                  item.checked && styles.shoppingItemTextChecked
                ]}
              >
                {item.checked ? '✅ ' : '⬜ '}
                {item.name}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.shoppingDeleteButton}
              onPress={() => deleteShoppingItem(item.id)}
            >
              <Text style={styles.shoppingDeleteText}>👍🏻</Text>
            </TouchableOpacity>
          </View>
        ))
      )}
    </View>
  </View>
)}

{/* ================= 分頁 5: 設定 ================= */}
{currentTab === 'profile' && (
  <View style={styles.pageContent}>

    {/* 個人檔案設定 */}
    <View style={styles.formCard}>
      <Text style={styles.sectionTitleBlock}>👤 個人檔案設定</Text>

      {!isEditingProfile ? (
        <View>
          <View style={styles.profileInfoBox}>
            <Text style={styles.profileText}>
              🐷 我的暱稱：
              <Text style={styles.profileHighlightText}>
                {nickname}
              </Text>
            </Text>

            <Text style={styles.profileText}>
              🛠️ 預設角色：
              <Text style={styles.profileStrongText}>
                {userRole === 'eat' ? '吃貨' : '大廚'}
              </Text>
            </Text>
          </View>

          <TouchableOpacity
            style={styles.profileEditButton}
            onPress={() => {
              setEditNickname(nickname);
              setEditRole(userRole);
              setEditGroupName(familyGroupName);
              setIsEditingProfile(true);
            }}
          >
            <Text style={styles.profileEditButtonText}>
              ✏️ 修改個人資料
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View>
          <Text style={styles.label}>修改我的暱稱：</Text>
          <TextInput
            style={styles.input}
            value={editNickname}
            onChangeText={setEditNickname}
          />

          <Text style={styles.label}>更換預設角色：</Text>
          <View style={styles.permissionRowSpaced}>
            <TouchableOpacity
              style={[
                styles.permBtn,
                editRole === 'eat' && styles.permBtnActive
              ]}
              onPress={() => setEditRole('eat')}
            >
              <Text style={styles.permBtnText}>🐷 吃貨</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.permBtn,
                editRole === 'cook' && styles.permBtnActive
              ]}
              onPress={() => setEditRole('cook')}
            >
              <Text style={styles.permBtnText}>🍳 大廚</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.profileEditButtonRow}>
            <TouchableOpacity
              style={styles.profileCancelButton}
              onPress={() => {
                setIsEditingProfile(false);
                setEditNickname(nickname);
                setEditRole(userRole);
              }}
            >
              <Text style={styles.profileCancelButtonText}>取消</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.profileSaveButton}
              onPress={() => {
                setEditGroupName(familyGroupName);
                handleSaveProfile();
                setIsEditingProfile(false);
              }}
            >
              <Text style={styles.profileSaveButtonText}>💾 儲存修改</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>

    {/* 修改家庭群組名稱 */}
    <View style={styles.formCard}>
      <Text style={styles.sectionTitleBlock}>🏠 修改家庭群組名稱</Text>

      {!isEditingGroupName ? (
        <View>
          <View style={styles.profileInfoBox}>
            <Text style={styles.profileText}>
              家庭群組名稱：
              <Text style={styles.profileStrongText}>
                {familyGroupName}
              </Text>
            </Text>
          </View>

          <TouchableOpacity
            style={styles.profileEditButton}
            onPress={() => {
              setEditNickname(nickname);
              setEditRole(userRole);
              setEditGroupName(familyGroupName);
              setIsEditingGroupName(true);
            }}
          >
            <Text style={styles.profileEditButtonText}>
              ✏️ 修改家庭群組名稱
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View>
          <Text style={styles.label}>修改家庭群組名稱：</Text>
          <TextInput
            style={styles.input}
            value={editGroupName}
            onChangeText={setEditGroupName}
          />

          <View style={styles.profileEditButtonRow}>
            <TouchableOpacity
              style={styles.profileCancelButton}
              onPress={() => {
                setIsEditingGroupName(false);
                setEditGroupName(familyGroupName);
              }}
            >
              <Text style={styles.profileCancelButtonText}>取消</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.profileSaveButton}
              onPress={() => {
                setEditNickname(nickname);
                setEditRole(userRole);
                handleSaveProfile();
                setIsEditingGroupName(false);
              }}
            >
              <Text style={styles.profileSaveButtonText}>💾 儲存修改</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>

    {/* 家庭群組成員管理 */}
    <View style={styles.formCard}>
      <View style={styles.profileSectionHeaderRow}>
        <Text style={styles.sectionTitleBlock}>
          👥 家庭群組成員管理 ({groupMembers.length}/10 人)
        </Text>

        {isCurrentUserAdmin && (
          <TouchableOpacity
            style={[
              styles.memberManageToggleButton,
              isManagingMembers && styles.memberManageToggleButtonActive
            ]}
            onPress={() => setIsManagingMembers(prev => !prev)}
          >
            <Text style={styles.memberManageToggleButtonText}>
              {isManagingMembers ? '完成' : '管理'}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      <TouchableOpacity
        activeOpacity={0.8}
        onLongPress={handleCopyGroupInviteCode}
        style={styles.groupCodeCopyBox}
      >
        <Text style={styles.groupCodeText}>
          群組代碼：{groupInviteCode} (邀請新成員時使用・長按複製)
        </Text>

        </TouchableOpacity>

      {(groupMembers || []).map(member => {
        const displayName = member.isMe ? `${member.name} (我自己)` : member.name;
        const isCook = member.userRole === 'cook';

        return (
          <View key={member.id} style={styles.memberCard}>
            <View style={styles.memberTopRow}>
              <View style={styles.memberInfoArea}>
                <Text style={styles.memberNameText}>
                  {displayName}
                </Text>

                <Text
                  style={[
                    styles.memberRoleText,
                    isCook && styles.memberRoleCookText
                  ]}
                >
                  {isCook ? '🍳 主要掌廚' : '🐷 快樂吃貨'}
                </Text>
              </View>

              <Text style={styles.memberGroupRoleText}>
                {member.isMe
                  ? '目前登入者'
                  : member.groupRole === 'owner'
                    ? '群組擁有人'
                    : member.groupRole === 'admin'
                      ? 'Admin'
                      : '群組成員'}
              </Text>
            </View>

            {isManagingMembers &&
              isCurrentUserAdmin &&
              !member.isMe &&
              member.groupRole !== 'owner' && (
                <View style={styles.memberButtonRow}>
                  <TouchableOpacity
                    style={[
                      styles.memberSmallButton,
                      member.groupRole === 'admin'
                        ? styles.memberAdminToggleOffButton
                        : styles.memberAdminToggleOnButton
                    ]}
                    onPress={() => handleToggleAdmin(member)}
                  >
                    <Text style={styles.memberSmallButtonText}>
                      {member.groupRole === 'admin' ? '取消 admin' : '設為 admin'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.memberSmallButton, styles.memberRemoveButton]}
                    onPress={() => handleRemoveGroupMemberByAdmin(member)}
                  >
                    <Text style={styles.memberRemoveButtonText}>
                      ❌ 移除
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
          </View>
        );
      })}
    </View>

    {/* 切換 / 加入其他群組 */}
    <View style={styles.formCard}>
      <Text style={styles.sectionTitleBlock}>🔄 加入其他群組</Text>

      <Text style={styles.label}>輸入群組邀請碼：</Text>
      <TextInput
        style={styles.input}
        placeholder="例如：A7K9QX"
        placeholderTextColor="#B8A89A"
        value={inputInviteCode}
        onChangeText={setInputInviteCode}
        autoCapitalize="characters"
      />

      <TouchableOpacity
        style={styles.mainActionBtnAlt}
        onPress={handleSwitchOrJoinGroup}
      >
        <Text style={styles.mainActionText}>
          🔑 切換 / 加入群組
        </Text>
      </TouchableOpacity>
    </View>

    {/* 帳號管理 */}
    <View style={styles.formCard}>
      <Text style={styles.sectionTitleBlock}>⚠️ 帳號與群組管理</Text>

      <TouchableOpacity
        style={styles.logoutButton}
        onPress={handleLogout}
      >
        <Text style={styles.mainActionText}>
          🚪 登出帳號
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.deleteAccountButton}
        onPress={() => handleDeleteMyAccount()}
      >
        <Text style={styles.mainActionText}>
          🗑️ 刪除我的帳號
        </Text>
      </TouchableOpacity>
    </View>

  </View>
)}
      </ScrollView>

{showScrollTopBtn && (
  <TouchableOpacity
    style={styles.scrollTopButton}
    onPress={() => {
      scrollViewRef.current?.scrollTo({ y: 0, animated: true });
    }}
  >
    <Text style={styles.scrollTopText}>⬆</Text>
  </TouchableOpacity>
)}

      {/* ================= 各種 Modals ================= */}
{/* ================= 明日特別通知提醒 Modal ================= */}
<Modal
  visible={specialNoticeReminderModalVisible}
  transparent
  animationType="fade"
  onRequestClose={() => setSpecialNoticeReminderModalVisible(false)}
>
  <View style={styles.modalOverlay}>
    <View style={styles.modalCard}>
      <Text style={styles.sectionTitleLarge}>
        🔔 特別通知
      </Text>

      {(Array.isArray(specialNoticePopupItems) ? specialNoticePopupItems : []).map(notice => {
        const noticeDisplayText = getSpecialNoticeDisplayText(notice);

        return (
          <View key={notice.id} style={styles.requestCard}>
            <View style={styles.requestCardHeader}>
              <Text style={styles.dishName}>
                🙋‍♂️ {notice.senderNickname || notice.senderEmail || '未知'}
              </Text>

              <Text style={[styles.statusBadge, styles.statusBadgePending]}>
  {notice.popupType === 'reminder' ? '明天提醒' : '新通知'}
</Text>
            </View>

            <Text style={styles.requestMetaText}>
              通知：
              <Text style={styles.requestMetaStrong}>
                {noticeDisplayText}
              </Text>
            </Text>

            <Text style={styles.requestMetaTextBottom}>
              日期：
              <Text style={styles.timeHighlight}>
                {normalizeDateString(notice.date || '')}
              </Text>
            </Text>
          </View>
        );
      })}

      <View style={styles.specialNoticeButtonGroup}>
        <TouchableOpacity
          activeOpacity={0.85}
          style={[
            styles.specialNoticeFullButton,
            styles.specialNoticeSubmitButton
          ]}
          onPress={dismissAllSpecialNoticePopups}
        >
          <Text style={styles.specialNoticePrimaryButtonText}>
            知道了
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.85}
          style={[
            styles.specialNoticeFullButton,
            styles.specialNoticeBackButton
          ]}
          onPress={() => setSpecialNoticeReminderModalVisible(false)}
        >
          <Text style={styles.specialNoticeBackButtonText}>
            稍後再看
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  </View>
</Modal>
{/* ================= 批量修改菜式標籤 Modal ================= */}
<Modal
  visible={bulkDishTagModalVisible}
  transparent
  animationType="slide"
  presentationStyle="overFullScreen"
  statusBarTranslucent
  onRequestClose={() => setBulkDishTagModalVisible(false)}
>
  <View style={styles.modalOverlay}>
    <View style={styles.modalCard}>
      <View style={styles.modalHeaderRow}>
        <Text style={styles.sectionTitleLarge}>
          🏷️ 批量修改標籤
        </Text>

        <TouchableOpacity
          onPress={() => setBulkDishTagModalVisible(false)}
        >
          <Text style={styles.modalCloseText}>✕</Text>
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
<View style={styles.subTabContainer}>
  {renderSubTabButton(
    `➕ 加入標籤 (${bulkAddDishTags.length})`,
    bulkTagEditMode === 'add',
    () => setBulkTagEditMode('add')
  )}

  {renderSubTabButton(
    `➖ 移除標籤 (${bulkRemoveDishTags.length})`,
    bulkTagEditMode === 'remove',
    () => setBulkTagEditMode('remove')
  )}
</View>

{bulkTagEditMode === 'add' && (
  <>
    <Text style={styles.modalHintText}>
      選取後，這些標籤會加入到已選的菜式中。
    </Text>

    {renderBulkTagPicker('add')}
  </>
)}

{bulkTagEditMode === 'remove' && (
  <>
    <Text style={styles.modalHintText}>
      選取後，這些標籤會從已選的菜式中移除。
    </Text>

    {renderBulkTagPicker('remove')}
  </>
)}



        <View style={styles.profileEditButtonRow}>
          <TouchableOpacity
            style={styles.profileCancelButton}
            onPress={() => setBulkDishTagModalVisible(false)}
          >
            <Text style={styles.profileCancelButtonText}>
              取消
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.profileSaveButton}
            onPress={handleApplyBulkDishTags}
          >
            <Text style={styles.profileSaveButtonText}>
              💾 套用修改
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  </View>
</Modal>
{/* 已隱藏菜式管理 Modal */}
<Modal
  animationType="slide"
  transparent={true}
  visible={hiddenDishesModalVisible}
  onRequestClose={() => setHiddenDishesModalVisible(false)}
>
  <View style={styles.modalCentered}>
    <View style={styles.hiddenDishesModalView}>
      <Text style={styles.modalTitle}>
        🙈 已隱藏菜式 ({(hiddenDishesForCurrentGroup || []).length})
      </Text>

      {(hiddenDishesForCurrentGroup || []).length === 0 ? (
        <Text style={styles.emptyModalText}>
          目前沒有被此群組隱藏的菜式。
        </Text>
      ) : (
        <ScrollView
          style={styles.hiddenDishesScroll}
          keyboardShouldPersistTaps="handled"
        >
          {(hiddenDishesForCurrentGroup || []).map(dish => {
            const status = String(
              dish.publishStatus ?? (dish.isPublic ? 'approved' : 'private')
            ).trim().toLowerCase();

            return (
              <View
                key={dish.id}
                style={styles.hiddenDishCard}
              >
                <View style={styles.dishCardHeader}>
                  <Text style={styles.dishName}>{dish.name}</Text>

                  <Text
                    style={[
                      styles.dishStatusText,
                      status === 'approved' && styles.dishStatusApproved,
                      status !== 'approved' && styles.dishStatusPrivate
                    ]}
                  >
                    {status === 'approved' ? '🌐 公開' : '🔒 私房'}
                  </Text>
                </View>

                <Text style={styles.dishDetails}>
                  材料: {dish.ingredients} | 分類: {Array.isArray(dish.tags) ? dish.tags.join(', ') : ''}
                </Text>

                <TouchableOpacity
                  style={styles.restoreDishButton}
                  onPress={() => handleAdminRestoreHiddenDish(dish)}
                >
                  <Text style={styles.restoreDishButtonText}>
                    ↩️ 還原到菜式庫
                  </Text>
                </TouchableOpacity>
              </View>
            );
          })}
        </ScrollView>
      )}

      <View style={styles.modalFooterButtonArea}>
        <Button
          title="關閉"
          color="gray"
          onPress={() => setHiddenDishesModalVisible(false)}
        />
      </View>
    </View>
  </View>
</Modal>
{/* 已隱藏水果管理 Modal */}
<Modal
  animationType="slide"
  transparent={true}
  visible={hiddenFruitsModalVisible}
  onRequestClose={() => setHiddenFruitsModalVisible(false)}
>
  <View style={styles.modalCentered}>
    <View style={styles.hiddenDishesModalView}>
      <Text style={styles.modalTitle}>
        🙈 已隱藏水果 ({(hiddenFruitsForCurrentGroup || []).length})
      </Text>

      {(hiddenFruitsForCurrentGroup || []).length === 0 ? (
        <Text style={styles.emptyModalText}>
          目前沒有被此群組隱藏的水果。
        </Text>
      ) : (
        <ScrollView
          style={styles.hiddenDishesScroll}
          keyboardShouldPersistTaps="handled"
        >
          {(hiddenFruitsForCurrentGroup || []).map(fruit => {
            const status = String(
              fruit.publishStatus ?? (fruit.isPublic ? 'approved' : 'private')
            ).trim().toLowerCase();

            return (
              <View
                key={fruit.id}
                style={styles.hiddenDishCard}
              >
                <View style={styles.dishCardHeader}>
                  <Text style={styles.dishName}>🍎 {fruit.name}</Text>

                  <Text
                    style={[
                      styles.dishStatusText,
                      status === 'approved' && styles.dishStatusApproved,
                      status !== 'approved' && styles.dishStatusPrivate
                    ]}
                  >
                    {status === 'approved' ? '🌐 公開' : '🔒 私房'}
                  </Text>
                </View>

                <Text style={styles.dishDetails}>
                  季節: {Array.isArray(fruit.seasons) ? fruit.seasons.join(', ') : ''}
                </Text>

                <TouchableOpacity
                  style={styles.restoreDishButton}
                  onPress={() => handleAdminRestoreHiddenFruit(fruit)}
                >
                  <Text style={styles.restoreDishButtonText}>
                    ↩️ 還原到水果庫
                  </Text>
                </TouchableOpacity>
              </View>
            );
          })}
        </ScrollView>
      )}

      <View style={styles.modalFooterButtonArea}>
        <Button
          title="關閉"
          color="gray"
          onPress={() => setHiddenFruitsModalVisible(false)}
        />
      </View>
    </View>
  </View>
</Modal>

{/* ================= 新增菜式 Modal ================= */}
<Modal
  visible={addDishModalVisible}
  transparent
  animationType="slide"
  presentationStyle="overFullScreen"
  statusBarTranslucent
  onRequestClose={() => setAddDishModalVisible(false)}
>
  <View style={styles.modalOverlay}>
    <View style={styles.modalCard}>
      <View style={styles.modalHeaderRow}>
        <Text style={styles.sectionTitleLarge}>
          ➕  新增菜式
        </Text>

        <TouchableOpacity
          onPress={() => setAddDishModalVisible(false)}
        >
          <Text style={styles.modalCloseText}>✕</Text>
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        <Text style={styles.label}>1. 菜式名稱 *</Text>
        <TextInput
          style={styles.input}
          value={newDishName}
          onChangeText={setNewDishName}
          placeholderTextColor="#B8A89A"
        />

        {recommendedDishes.length > 0 && (
          <View style={styles.recommendBox}>
            <Text style={styles.recommendWarningText}>
              ⚠️ 提示：已有相似菜色：
            </Text>

            {recommendedDishes.map(r => (
              <Text key={r.id} style={styles.recommendItemText}>
                • {r.name}
              </Text>
            ))}
          </View>
        )}

        <Text style={styles.label}>2. 食材</Text>
        <TextInput
          style={styles.input}
          value={newDishIngredients}
          onChangeText={setNewDishIngredients}
          placeholderTextColor="#B8A89A"
        />

        <View style={styles.formSectionHeaderRow}>
          <Text style={styles.label}>3. 分類標籤 </Text>

          <TouchableOpacity
            style={styles.inlineManageButton}
            onPress={() => setCustomModalVisible(true)}
          >
            <Text style={styles.inlineManageButtonText}>
              ⚙️ 管理標籤
            </Text>
          </TouchableOpacity>
        </View>

        {getSortedCategoryKeys().map(key => {
          const cat = dynamicCategories[key];

          return (
            <View key={`dish-modal-add-${key}`} style={styles.addCategoryBlock}>
              <Text style={styles.miniCategoryLabel}>
                {cat.title}
              </Text>

              {cat.isNested ? (
                getSortedSubCategoryKeys(key).map(subKey => (
                  <View key={subKey} style={styles.addSubCategoryBlock}>
                    <Text style={styles.miniCategoryLabel}>
                      └ {cat.subCategories[subKey].title}
                    </Text>

                    <View style={styles.tagContainer}>
                      {getSortedTags(cat.subCategories[subKey].tags, key, subKey).map(t => {
                        const isSelected = addPageSelectedTags.includes(t);

                        return (
                          <TouchableOpacity
                            key={t}
                            style={[
                              styles.miniSelectBtn,
                              isSelected && styles.miniSelectBtnActive
                            ]}
                            onPress={() => {
                              setAddPageSelectedTags(prev =>
                                prev.includes(t)
                                  ? prev.filter(x => x !== t)
                                  : [...prev, t]
                              );
                            }}
                          >
                            <Text
                              style={[
                                styles.miniSelectBtnText,
                                isSelected && styles.miniSelectBtnTextActive
                              ]}
                            >
                              {t}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                ))
              ) : (
                <View style={styles.tagContainer}>
                  {getSortedTags(cat.tags, key).map(t => {
                    const isSelected = addPageSelectedTags.includes(t);

                    return (
                      <TouchableOpacity
                        key={t}
                        style={[
                          styles.miniSelectBtn,
                          isSelected && styles.miniSelectBtnActive
                        ]}
                        onPress={() => {
                          setAddPageSelectedTags(prev =>
                            prev.includes(t)
                              ? prev.filter(x => x !== t)
                              : [...prev, t]
                          );
                        }}
                      >
                        <Text
                          style={[
                            styles.miniSelectBtnText,
                            isSelected && styles.miniSelectBtnTextActive
                          ]}
                        >
                          {t}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </View>
          );
        })}

        <Text style={styles.label}>4. 發佈權限</Text>

        <View style={styles.permissionRow}>
          <TouchableOpacity
            style={[
              styles.permBtn,
              !isPublic && styles.permBtnActive
            ]}
            onPress={() => setIsPublic(false)}
          >
            <Text style={styles.permBtnText}>
              🔒 {familyGroupName}私有
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.permBtn,
              isPublic && styles.permBtnActive
            ]}
            onPress={() => setIsPublic(true)}
          >
            <Text style={styles.permBtnText}>
              🌐 公開分享
            </Text>
          </TouchableOpacity>
        </View>

<View style={styles.profileEditButtonRow}>
  <TouchableOpacity
    style={styles.profileCancelButton}
    onPress={() => setAddDishModalVisible(false)}
  >
    <Text style={styles.profileCancelButtonText}>
      取消
    </Text>
  </TouchableOpacity>

  <TouchableOpacity
    style={styles.profileSaveButton}
    onPress={async () => {
      try {
        await handleAddDish();
        setAddDishModalVisible(false);
      } catch (error) {
        console.log('handleAddDish error:', error);
      }
    }}
  >
    <Text style={styles.profileSaveButtonText}>
      💾 儲存食譜
    </Text>
  </TouchableOpacity>
</View>
      </ScrollView>
    </View>
  </View>
</Modal>
{/* ================= 新增水果 Modal ================= */}
<Modal
  visible={addFruitModalVisible}
  transparent
  animationType="slide"
  presentationStyle="overFullScreen"
  statusBarTranslucent
  onRequestClose={() => setAddFruitModalVisible(false)}
>
  <View style={styles.modalOverlay}>
    <View style={styles.modalCard}>
      <View style={styles.modalHeaderRow}>
        <Text style={styles.sectionTitleLarge}>
          ➕ 新增水果
        </Text>

        <TouchableOpacity
          onPress={() => setAddFruitModalVisible(false)}
        >
          <Text style={styles.modalCloseText}>✕</Text>
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        <Text style={styles.label}>1. 水果名稱 *</Text>
        <TextInput
          style={styles.input}
          value={newFruitName}
          onChangeText={setNewFruitName}
          placeholderTextColor="#B8A89A"
        />

        <Text style={styles.label}>2. 季節標籤</Text>

        <View style={styles.tagContainer}>
          {getSortedFruitSeasons().map(season => {
            const isSelected = newFruitSeasons.includes(season);

            return (
              <TouchableOpacity
                key={season}
                style={[
                  styles.miniSelectBtn,
                  isSelected && styles.miniSelectBtnActive
                ]}
                onPress={() => {
                  setNewFruitSeasons(prev =>
                    prev.includes(season)
                      ? prev.filter(x => x !== season)
                      : [...prev, season]
                  );
                }}
              >
                <Text
                  style={[
                    styles.miniSelectBtnText,
                    isSelected && styles.miniSelectBtnTextActive
                  ]}
                >
                  {season}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.label}>3. 發佈權限</Text>

        <View style={styles.permissionRow}>
          <TouchableOpacity
            style={[
              styles.permBtn,
              !newFruitIsPublic && styles.permBtnActive
            ]}
            onPress={() => setNewFruitIsPublic(false)}
          >
            <Text style={styles.permBtnText}>
              🔒 {familyGroupName}私有
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.permBtn,
              newFruitIsPublic && styles.permBtnActive
            ]}
            onPress={() => setNewFruitIsPublic(true)}
          >
            <Text style={styles.permBtnText}>
              🌐 公開分享
            </Text>
          </TouchableOpacity>
        </View>

<View style={styles.profileEditButtonRow}>
  <TouchableOpacity
    style={styles.profileCancelButton}
    onPress={() => setAddDishModalVisible(false)}
  >
    <Text style={styles.profileCancelButtonText}>
      取消
    </Text>
  </TouchableOpacity>

<TouchableOpacity
  style={styles.profileSaveButton}
  onPress={async () => {
    try {
      await handleAddFruit();
      setAddFruitModalVisible(false);
    } catch (error) {
      console.log('handleAddFruit error:', error);
    }
  }}
>
  <Text style={styles.profileSaveButtonText}>
    💾 儲存水果
  </Text>
</TouchableOpacity>
</View>
      </ScrollView>
    </View>
  </View>
</Modal>

{/* ================= 全新：支援細分類選取的底部彈出半分頁 ================= */}
<Modal
  visible={customModalVisible}
  animationType="slide"
  transparent={true}
  onRequestClose={() => setCustomModalVisible(false)}
>
  <View style={styles.bottomSheetOverlay}>
    <View style={styles.bottomSheetContainer}>

      {/* 標題欄 */}
      <View style={styles.bottomSheetHeader}>
        <Text style={styles.bottomSheetTitle}>🛠️ 管理標籤</Text>

        <TouchableOpacity
          onPress={() => setCustomModalVisible(false)}
          style={styles.bottomSheetCloseButton}
        >
          <Text style={styles.bottomSheetCloseText}>✕</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.bottomSheetScroll}
        keyboardShouldPersistTaps="handled"
contentContainerStyle={{
  paddingBottom: 100 + Math.max(insets.bottom, 16)
}}
      >
        {/* 部分一：加入新分類 */}
        <View style={styles.tagManagerSection}>
          <Text style={styles.tagManagerSectionTitlePink}>
            🔸 加入自訂分類
          </Text>

          <TextInput
            style={styles.input}
            placeholderTextColor="#B8A89A"
            value={newCategoryName}
            onChangeText={setNewCategoryName}
          />
        </View>

        {/* 部分二：加入新標籤 */}
        <View style={styles.tagManagerSection}>
          <Text style={styles.tagManagerSectionTitlePink}>
            🔸 加入自訂標籤
          </Text>

          <TextInput
            style={styles.input}
            placeholderTextColor="#B8A89A"
            value={newModalTagName}
            onChangeText={setNewModalTagName}
          />

          {/* 選擇加入哪個分類：只有在「沒有輸入新分類」時才需要選 */}
          {newCategoryName.trim() === '' && (
            <View style={styles.modalCategoryPickerArea}>
              <Text style={styles.modalSmallHintText}>
                此自訂標籤的分類：
              </Text>

              <View style={styles.modalCategoryChipWrap}>
                {/* 1. 先渲染最常用的前 4 個原生分類 */}
                {getSortedCategoryKeys().slice(0, 4).map(catKey => {
                  const isSelected = selectedModalCat === catKey;

                  return (
                    <TouchableOpacity
                      key={catKey}
                      style={[
                        styles.modalCategoryChip,
                        isSelected && styles.modalCategoryChipSelected
                      ]}
                      onPress={() => {
                        if (selectedModalCat === catKey) {
                          setSelectedModalCat('none');
                          setSelectedSubModalCat('');
                        } else {
                          setSelectedModalCat(catKey);

                          if (dynamicCategories[catKey].isNested) {
                            setSelectedSubModalCat(
                              Object.keys(dynamicCategories[catKey].subCategories)[0]
                            );
                          } else {
                            setSelectedSubModalCat('');
                          }
                        }
                      }}
                    >
                      <Text
                        style={[
                          styles.modalCategoryChipText,
                          isSelected && styles.modalCategoryChipTextSelected
                        ]}
                      >
                        {dynamicCategories[catKey].title}
                      </Text>
                    </TouchableOpacity>
                  );
                })}

                {/* 2. 展開狀態下，才顯示第 5 個以後的自訂與其他分類 */}
                {getSortedCategoryKeys().length > 4 && showMoreModalCats && (
                  getSortedCategoryKeys().slice(4).map(catKey => {
                    const isSelected = selectedModalCat === catKey;

                    return (
                      <TouchableOpacity
                        key={catKey}
                        style={[
                          styles.modalCategoryChip,
                          isSelected && styles.modalCategoryChipSelected
                        ]}
                        onPress={() => {
                          if (selectedModalCat === catKey) {
                            setSelectedModalCat('none');
                            setSelectedSubModalCat('');
                          } else {
                            setSelectedModalCat(catKey);

                            if (dynamicCategories[catKey].isNested) {
                              setSelectedSubModalCat(
                                Object.keys(dynamicCategories[catKey].subCategories)[0]
                              );
                            } else {
                              setSelectedSubModalCat('');
                            }
                          }
                        }}
                      >
                        <Text
                          style={[
                            styles.modalCategoryChipText,
                            isSelected && styles.modalCategoryChipTextSelected
                          ]}
                        >
                          {dynamicCategories[catKey].title}
                        </Text>
                      </TouchableOpacity>
                    );
                  })
                )}

                {/* 3. 切換展開與收合的收納按鈕 */}
                {getSortedCategoryKeys().length > 4 && (
                  <TouchableOpacity
                    style={styles.moreCategoryToggleButton}
                    onPress={() => setShowMoreModalCats(prev => !prev)}
                  >
                    
<Text style={styles.moreCategoryToggleText}>
  {showMoreModalCats ? '收起' : '更多分類'}
</Text>

                  </TouchableOpacity>
                )}
              </View>

              {/* 4. 如果選中的分類有巢狀子分類（像是食物種類），繼續動態呈現細分類項 */}
              {selectedModalCat !== 'none' && dynamicCategories[selectedModalCat]?.isNested && (
                <View style={styles.modalSubCategoryBox}>
                  <Text style={styles.modalSubCategoryHint}>
                    └ 請選擇目標細分類：
                  </Text>

                  <View style={styles.modalCategoryChipWrap}>
                    {getSortedSubCategoryKeys(selectedModalCat).map(subKey => {
                      const isSelected = selectedSubModalCat === subKey;

                      return (
                        <TouchableOpacity
                          key={subKey}
                          style={[
                            styles.modalSubCategoryChip,
                            isSelected && styles.modalSubCategoryChipSelected
                          ]}
                          onPress={() => setSelectedSubModalCat(subKey)}
                        >
                          <Text
                            style={[
                              styles.modalSubCategoryChipText,
                              isSelected && styles.modalSubCategoryChipTextSelected
                            ]}
                          >
                            {dynamicCategories[selectedModalCat].subCategories[subKey].title}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              )}
            </View>
          )}
        </View>

 {/* 下方控制按鈕列 */}
<View style={styles.modalButtonRow}>
  <TouchableOpacity
    style={styles.bottomSheetCancelButton}
    onPress={() => setCustomModalVisible(false)}
  >
    <Text style={styles.bottomSheetCancelButtonText}>取消</Text>
  </TouchableOpacity>

  <TouchableOpacity
    style={styles.modalSaveButton}
    onPress={handleSaveTagsAndCategories}
  >
    <Text style={styles.modalSaveButtonText}>
      儲存變更
    </Text>
  </TouchableOpacity>
</View>

        {/* 底部：編輯自訂分類 / 標籤 */}
        <View style={styles.customEditSection}>
          <TouchableOpacity
            style={[
              styles.customEditToggleButton,
              isEditingCustomTags && styles.customEditToggleButtonActive
            ]}
            onPress={() => setIsEditingCustomTags(prev => !prev)}
          >
            <Text style={styles.customEditToggleText}>
              {isEditingCustomTags ? '收起編輯區' : '✏️ 編輯自訂分類 / 標籤'}
            </Text>
          </TouchableOpacity>

          {isEditingCustomTags && (
            <View>


              {/* 自訂分類區 */}
              <Text style={styles.customCategoryTitle}>
                📁 自訂分類
              </Text>

              {getCustomAddedCategories().length === 0 ? (
                <Text style={styles.customEmptyText}>
                  目前沒有自訂分類。
                </Text>
              ) : (
                getCustomAddedCategories().map(item => {
                  const isSelected = selectedCustomCategoryKeys.includes(item.catKey);

                  return (
                    <TouchableOpacity
                      key={item.catKey}
                      style={styles.customManageRow}
                      onPress={() => toggleCustomCategorySelection(item.catKey)}
                    >
                      <View style={styles.customManageRowMain}>
                        <Text style={styles.customManageNameText}>
                          {isSelected ? '✅' : '⬜'} {item.title}
                        </Text>

                        <Text style={styles.customManageMetaText}>
                          內含標籤：{item.tagCount} 個
                        </Text>
                      </View>

                      <Text
                        style={[
                          styles.customManageStateText,
                          isSelected && styles.customManageStateTextSelected
                        ]}
                      >
                        {isSelected ? '已選取' : '點擊選取'}
                      </Text>
                    </TouchableOpacity>
                  );
                })
              )}

              {/* 自訂標籤區 */}
              <Text style={styles.customTagTitle}>
                🏷️ 自訂標籤
              </Text>

              {getCustomAddedTags().length === 0 ? (
                <Text style={styles.customEmptyText}>
                  目前沒有自訂標籤。
                </Text>
              ) : (
                getCustomAddedTags().map(item => {
                  const isSelected = selectedCustomTagNames.includes(item.tag);

                  return (
                    <TouchableOpacity
                      key={`${item.catKey}-${item.subKey || 'main'}-${item.tag}`}
                      style={styles.customManageRow}
                      onPress={() => toggleCustomTagSelection(item.tag)}
                    >
                      <View style={styles.customManageRowMain}>
                        <Text style={styles.customManageNameText}>
                          {isSelected ? '✅' : '⬜'} {item.tag}
                        </Text>

                        <Text style={styles.customManageMetaText}>
                          分類：{item.categoryTitle}
                          {item.subCategoryTitle ? ` / ${item.subCategoryTitle}` : ''}
                        </Text>
                      </View>

                      <Text
                        style={[
                          styles.customManageStateText,
                          isSelected && styles.customManageStateTextSelected
                        ]}
                      >
                        {isSelected ? '已選取' : '點擊選取'}
                      </Text>
                    </TouchableOpacity>
                  );
                })
              )}

              {/* 批量刪除按鈕 */}
              <TouchableOpacity
                style={[
                  styles.bulkDeleteButton,
                  selectedCustomTagNames.length + selectedCustomCategoryKeys.length === 0 &&
                    styles.bulkDeleteButtonDisabled
                ]}
                disabled={selectedCustomTagNames.length + selectedCustomCategoryKeys.length === 0}
                onPress={handleDeleteSelectedCustomItems}
              >
                <Text style={styles.bulkDeleteButtonText}>
                  🗑️ 刪除已選項目（
                  {selectedCustomCategoryKeys.length} 個分類，
                  {selectedCustomTagNames.length} 個標籤）
                </Text>
              </TouchableOpacity>

              {/* 完成編輯並關閉 */}
              <TouchableOpacity
                style={styles.finishEditButton}
                onPress={() => {
                  setIsEditingCustomTags(false);
                  setSelectedCustomTagNames([]);
                  setSelectedCustomCategoryKeys([]);
                  setCustomModalVisible(false);
                }}
              >
                <Text style={styles.finishEditButtonText}>
                  完成編輯並關閉
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  </View>
</Modal>



{/* 點菜建議 Modal */}
<Modal
  animationType="slide"
  transparent={true}
  visible={requestModalVisible}
  onRequestClose={() => setRequestModalVisible(false)}
>
  <View style={styles.modalCentered}>
    <View style={styles.modalView}>
      <Text style={styles.modalTitle}>🍲 提出想吃建議</Text>

      {selectedDish && (
        <View style={styles.modalContentFull}>
          <Text style={styles.label}>
            菜餚名稱：
            <Text style={styles.modalStrongText}>
              {selectedDish.name}
            </Text>
          </Text>

          <Text style={styles.label}>指定家庭大廚：</Text>
          <TouchableOpacity
            style={styles.dropdownHeader}
            onPress={() => setCookDropdownOpen(!cookDropdownOpen)}
          >
            <Text style={styles.dropdownHeaderText}>
              {targetCook ? `👨‍🍳 ${targetCook}` : '請選擇大廚'} ▼
            </Text>
          </TouchableOpacity>

          {cookDropdownOpen && (
            <View style={styles.dropdownList}>
              {cookOptions.map(member => (
                <TouchableOpacity
                  key={member.email || member.id}
                  style={styles.dropdownItem}
                  onPress={() => {
                    setTargetCook(member.name || '');
                    setTargetCookEmail(member.email || '');
                    setCookDropdownOpen(false);
                  }}
                >
                  <Text style={styles.dropdownItemText}>
                    {member.name} {member.userRole === 'cook' ? '🍳 (負責做飯)' : ''}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <Text style={styles.label}>餐次種類：</Text>
          <TouchableOpacity
            style={styles.dropdownHeader}
            onPress={() => setMealDropdownOpen(!mealDropdownOpen)}
          >
            <Text style={styles.dropdownHeaderText}>
              {selectedMeal ? `⏰ ${selectedMeal}` : '請選擇餐次'} ▼
            </Text>
          </TouchableOpacity>

          {mealDropdownOpen && (
            <View style={styles.dropdownList}>
              {['早餐', '午餐', '下午茶', '晚餐', '宵夜'].map(meal => (
                <TouchableOpacity
                  key={meal}
                  style={styles.dropdownItem}
                  onPress={() => {
                    setSelectedMeal(meal);
                    setMealDropdownOpen(false);
                  }}
                >
                  <Text style={styles.dropdownItemText}>
                    {meal}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <Text style={styles.label}>預計用餐日期 (YYYY-MM-DD)：</Text>
          <TouchableOpacity
  onPress={() => setCalendarVisible(true)}
>
  <View style={styles.input}>
    <Text>
      {customDateInput || '請選擇日期'}
    </Text>
  </View>
</TouchableOpacity>

          <TouchableOpacity
            style={styles.checkboxRow}
            onPress={() => {
              const nextValue = autoAddToList === true ? false : true;
              setAutoAddToList(nextValue);
              setLastAutoAddToList(nextValue);
            }}
          >
            <Text style={styles.checkboxIcon}>
              {autoAddToList === true ? '✅' : '⬜'}
            </Text>

            <Text style={styles.checkboxLabel}>
              將此菜餚食材自動同步加入「購物清單」
            </Text>
          </TouchableOpacity>

          <View style={styles.modalButtonRow}>
            <TouchableOpacity
              style={[styles.modalBtn, styles.modalCancelButton]}
              onPress={() => setRequestModalVisible(false)}
            >
              <Text style={styles.modalBtnText}>取消</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.modalBtn, styles.modalPrimaryButton]}
              onPress={sendRequest}
            >
              <Text style={styles.modalBtnText}>🚀 送出建議</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  </View>
</Modal>
{/* 日曆 Modal：點菜 / 排餐日期選擇 */}
<Modal
  visible={calendarVisible}
  transparent
  animationType="fade"
  onRequestClose={() => setCalendarVisible(false)}
>
  <View
    style={{
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.4)',
      justifyContent: 'center',
      padding: 20
    }}
  >
    <View
      style={{
        backgroundColor: '#fff',
        borderRadius: 16,
        padding: 10
      }}
    >
      <View style={styles.calendarContainer}>
        {/* Header */}
        <View style={styles.monthSwitcherRow}>
          <TouchableOpacity onPress={handlePrevMonth}>
            <Text style={styles.switchMonthText}>◀</Text>
          </TouchableOpacity>

          <Text style={styles.monthTitle}>
            {currentYear}年 {currentMonth}月
          </Text>

          <TouchableOpacity onPress={handleNextMonth}>
            <Text style={styles.switchMonthText}>▶</Text>
          </TouchableOpacity>
        </View>

        {/* 星期 */}
        <View style={styles.calendarHeaderRow}>
          {['日', '一', '二', '三', '四', '五', '六'].map(w => (
            <Text key={w} style={styles.calendarHeaderCell}>
              {w}
            </Text>
          ))}
        </View>

        {/* 日期 Grid */}
        <View style={styles.calendarGrid}>
          {calendarCells.map((day, index) => {
            if (!day) {
              return (
                <View
                  key={`calendar-empty-${index}`}
                  style={styles.calendarCellEmpty}
                />
              );
            }

            const thisDateStr =
              `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

            const isSelected = thisDateStr === customDateInput;
            const isPast = isPastDate(thisDateStr);

            return (
              <TouchableOpacity
                key={`calendar-day-${day}`}
                style={[
                  styles.calendarCell,
                  isSelected && { backgroundColor: '#FF8C42' },
                  isPast && { opacity: 0.4 }
                ]}
                onPress={() => {
                  if (isPast) {
                    showMessage('不能選擇過去日期');
                    return;
                  }

                  setCustomDateInput(thisDateStr);
                  setCalendarVisible(false);
                }}
              >
                <Text
                  style={{
                    color: isSelected ? '#fff' : '#333',
                    fontWeight: isSelected ? '800' : '600'
                  }}
                >
                  {day}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <TouchableOpacity
        onPress={() => setCalendarVisible(false)}
        style={{
          padding: 12,
          alignItems: 'center'
        }}
      >
        <Text>關閉</Text>
      </TouchableOpacity>
    </View>
  </View>
</Modal>

{/* 特別通知日期月曆 Modal */}
<Modal
  visible={specialNoticeCalendarVisible}
  transparent
  animationType="fade"
  onRequestClose={() => setSpecialNoticeCalendarVisible(false)}
>
  <View
    style={{
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.4)',
      justifyContent: 'center',
      padding: 20
    }}
  >
    <View
      style={{
        backgroundColor: '#fff',
        borderRadius: 16,
        padding: 10
      }}
    >
      <View style={styles.calendarContainer}>
        {/* Header */}
        <View style={styles.monthSwitcherRow}>
          <TouchableOpacity onPress={handlePrevSpecialNoticeMonth}>
            <Text style={styles.switchMonthText}>◀</Text>
          </TouchableOpacity>

          <Text style={styles.monthTitle}>
            {specialNoticeYear}年 {specialNoticeMonth}月
          </Text>

          <TouchableOpacity onPress={handleNextSpecialNoticeMonth}>
            <Text style={styles.switchMonthText}>▶</Text>
          </TouchableOpacity>
        </View>

        {/* 星期 */}
        <View style={styles.calendarHeaderRow}>
          {['日', '一', '二', '三', '四', '五', '六'].map(w => (
            <Text key={w} style={styles.calendarHeaderCell}>
              {w}
            </Text>
          ))}
        </View>

        {/* 日期 Grid */}
        <View style={styles.calendarGrid}>
          {specialNoticeCalendarCells.map((day, index) => {
            if (day === null) {
              return (
                <View
                  key={`special-date-empty-${index}`}
                  style={styles.calendarCellEmpty}
                />
              );
            }

            const thisDateStr =
              `${specialNoticeYear}-${String(specialNoticeMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

            const isSelected = thisDateStr === specialNoticeDateInput;
            const isPast = isPastDate(thisDateStr);

            return (
              <TouchableOpacity
                key={`special-date-${day}`}
                style={[
                  styles.calendarCell,
                  isSelected && { backgroundColor: '#FF8C42' },
                  isPast && { opacity: 0.4 }
                ]}
                onPress={() => {
                  if (isPast) {
                    showMessage('不能選擇過去日期');
                    return;
                  }

                  setSpecialNoticeDateInput(thisDateStr);
                  setSpecialNoticeCalendarVisible(false);
                }}
              >
                <Text
                  style={{
                    color: isSelected ? '#fff' : '#333',
                    fontWeight: isSelected ? '800' : '600'
                  }}
                >
                  {day}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <TouchableOpacity
          activeOpacity={0.85}
          style={[
            styles.specialNoticeFullButton,
            styles.specialNoticeBackButton,
            { marginTop: 12 }
          ]}
          onPress={() => setSpecialNoticeCalendarVisible(false)}
        >
          <Text style={styles.specialNoticeBackButtonText}>
            取消
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  </View>
</Modal>
{/* 水果想食 Modal */}
<Modal
  animationType="slide"
  transparent={true}
  visible={fruitRequestModalVisible}
  onRequestClose={() => setFruitRequestModalVisible(false)}
>
  <View style={styles.modalCentered}>
    <View style={styles.modalView}>
      <Text style={styles.modalTitle}>🍎 提出想食水果</Text>

      {selectedFruit && (
        <View style={styles.modalContentFull}>
          <Text style={styles.label}>
            水果名稱：
            <Text style={styles.modalStrongText}>
              {selectedFruit.name}
            </Text>
          </Text>

          <Text style={styles.label}>通知對象：</Text>
          <TouchableOpacity
            style={styles.dropdownHeader}
            onPress={() => setFruitTargetDropdownOpen(!fruitTargetDropdownOpen)}
          >
            <Text style={styles.dropdownHeaderText}>
              {fruitTargetName ? `👤 ${fruitTargetName}` : '請選擇通知對象'} ▼
            </Text>
          </TouchableOpacity>

          {fruitTargetDropdownOpen && (
            <View style={styles.dropdownList}>
              {cookOptions.map(member => (
                <TouchableOpacity
                  key={member.email || member.id}
                  style={styles.dropdownItem}
                  onPress={() => {
                    setFruitTargetName(member.name || '');
                    setFruitTargetEmail(member.email || '');
                    setFruitTargetDropdownOpen(false);
                  }}
                >
                  <Text style={styles.dropdownItemText}>
                    {member.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}


          <TouchableOpacity
            style={styles.checkboxRow}
            onPress={() => {
              const nextValue = fruitAutoAddToList === true ? false : true;
              setFruitAutoAddToList(nextValue);
              setLastAutoAddToList(nextValue);
            }}
          >
            <Text style={styles.checkboxIcon}>
              {fruitAutoAddToList === true ? '✅' : '⬜'}
            </Text>

            <Text style={styles.checkboxLabel}>
              將此水果加入「購物清單」
            </Text>
          </TouchableOpacity>

          <View style={styles.modalButtonRow}>
            <TouchableOpacity
              style={[styles.modalBtn, styles.modalCancelButton]}
              onPress={() => setFruitRequestModalVisible(false)}
            >
              <Text style={styles.modalBtnText}>取消</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.modalBtn, styles.modalPrimaryButton]}
              onPress={sendFruitRequest}
            >
              <Text style={styles.modalBtnText}>🚀 送出</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  </View>
</Modal>


{/* 大廚通知 Modal：發起人收到改期 / 拒絕 / 取消通知時彈出 */}
<Modal
  animationType="slide"
  transparent={true}
  visible={senderNotificationModalVisible && senderNotifications.length > 0}
  onRequestClose={dismissAllCookMessages}
>
  <View style={styles.modalCentered}>
    <View style={styles.modalView}>
      <Text style={styles.modalTitle}>📝 大廚通知</Text>

      <ScrollView
        style={styles.senderNotificationScroll}
        keyboardShouldPersistTaps="handled"
      >
        {senderNotifications.map(req => {
          const displayCooks = Array.isArray(req.mergedCooks)
            ? req.mergedCooks.join('、')
            : (req.targetCookName || req.target || '未知');

          return (
            <View
              key={getCookMessageKey(req)}
              style={styles.senderNotificationCard}
            >
              <Text style={styles.dishName}>
                🍽️ {req.dishName || '未命名菜式'}
              </Text>

              <Text style={styles.dishDetails}>
                日期餐次：{req.date || '未定日期'}（{req.meal || '未定餐次'}）
              </Text>

              <Text style={styles.cookMessageText}>
                {req.cookMessage}
              </Text>

              <TouchableOpacity
                style={styles.acknowledgeButton}
                onPress={() => dismissOneCookMessage(req)}
              >
                <Text style={styles.acknowledgeButtonText}>
                  知道了
                </Text>
              </TouchableOpacity>
            </View>
          );
        })}
      </ScrollView>

      <View style={styles.modalFooterButtonArea}>
        <Button
          title="全部知道了"
          color="#6c757d"
          onPress={dismissAllCookMessages}
        />
      </View>

      {rejectTargetRequest?.requestType === 'fruit' && (
  <View style={styles.tagContainer}>
    {FRUIT_REJECT_REASONS.map(reason => (
      <TouchableOpacity
        key={reason}
        style={styles.miniSelectBtn}
        onPress={() => setRejectReasonInput(reason)}
      >
        <Text style={styles.miniSelectBtnText}>
          {reason}
        </Text>
      </TouchableOpacity>
    ))}
  </View>
)}
    </View>
  </View>
</Modal>

{/* 收到的點菜要求 Modal */}
<Modal
  animationType="slide"
  transparent={true}
  visible={requestInboxVisible && incomingRequests.length > 0}
  onRequestClose={() => setRequestInboxVisible(false)}
>
  <View style={styles.modalCentered}>
    <View style={styles.modalView}>
      <Text style={styles.modalTitle}>📨 收到的點菜要求</Text>

      {incomingRequests.length === 0 ? (
        <Text style={styles.label}>目前沒有待處理的點菜要求。</Text>
      ) : (
        <ScrollView
          style={styles.requestInboxScroll}
          keyboardShouldPersistTaps="handled"
        >
          {incomingRequests.map(req => (
            <View
              key={req.id}
              style={styles.requestInboxCard}
            >
             <Text style={styles.dishName}>
  {req.requestType === 'fruit'
    ? `🍎 ${req.fruitName || req.dishName}`
    : `🍲 ${req.dishName}`}
</Text>

              <Text style={styles.dishDetails}>
                來自：{req.senderNickname || '未知用戶'}
              </Text>

              <Text style={styles.dishDetails}>
                日期：{req.date}｜餐別：{req.meal}
              </Text>

              <Text style={styles.dishDetails}>
                {req.requestType !== 'fruit' && (
  <Text style={styles.dishDetails}>
    材料：{req.ingredients || '未填寫'}
  </Text>
)}
              </Text>

              <View style={styles.requestInboxActionArea}>
 {req.status === 'pending' && (
  <TouchableOpacity
    style={[styles.requestInboxActionButton, styles.successActionButton]}
    onPress={() => handleApproveRequest(req.mergedRequestIds || [req.id])}
  >
    <Text style={styles.requestInboxActionText}>
      ✅ 同意
    </Text>
  </TouchableOpacity>
)}

{req.requestType !== 'fruit' && (
  <TouchableOpacity
    style={[styles.requestInboxActionButton, styles.infoActionButton]}
    onPress={() => openRescheduleModal(req)}
  >
    <Text style={styles.requestInboxActionText}>
      📅 改期並同意
    </Text>
  </TouchableOpacity>
)}

<TouchableOpacity
  style={[styles.requestInboxActionButton, styles.dangerActionButton]}
  onPress={() => openRejectModal(req)}
>
  <Text style={styles.requestInboxActionText}>
    {req.requestType === 'fruit' ? '❌ 取消' : '❌ 拒絕'}
  </Text>
</TouchableOpacity>

                {/* 大廚同意時，是否把材料加入購物清單 */}
                <TouchableOpacity
                  style={styles.checkboxRowCompact}
                  onPress={() => {
                    const nextValue = approveAddToList === true ? false : true;
                    setApproveAddToList(nextValue);
                    setLastApproveAddToList(nextValue);
                  }}
                >
                  <Text style={styles.checkboxIcon}>
                    {approveAddToList === true ? '✅' : '⬜'}
                  </Text>

                  <Text style={styles.checkboxLabel}>
                    同意後將此菜餚食材加入「購物清單」
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </ScrollView>
      )}

      <View style={styles.modalFooterButtonArea}>
        <Button
          title="關閉"
          color="gray"
          onPress={() => setRequestInboxVisible(false)}
        />
      </View>
    </View>
  </View>
</Modal>

{/* 改期 Modal：一定要放在收到的點菜要求 Modal 後面，才會蓋在最上層 */}
<Modal
  animationType="slide"
  transparent={true}
  visible={rescheduleModalVisible}
  onRequestClose={() => {
    if (!isRescheduleSubmitting) {
      setRescheduleModalVisible(false);
      setRescheduleTargetId(null);
      setRescheduleDateInput('');
    }
  }}
>
  <View style={styles.modalCentered}>
    <View style={styles.modalView}>
      <Text style={styles.modalTitle}>📅 修改點菜日期</Text>

      <Text style={styles.label}>新的日期：</Text>
      <TextInput
        style={styles.input}
        value={rescheduleDateInput}
        onChangeText={setRescheduleDateInput}
        placeholder="例如：2026-06-15"
        placeholderTextColor="#B8A89A"
      />

      <Text style={styles.label}>餐次：</Text>

      {/* 先顯示目前選中的餐次；按一下才展開其他選項 */}
      <TouchableOpacity
        style={styles.dropdownHeader}
        onPress={() => setRescheduleMealOptionsVisible(prev => !prev)}
      >
        <Text
          style={[
            styles.dropdownHeaderText,
            !rescheduleMealInput && styles.dropdownPlaceholderText
          ]}
        >
          {rescheduleMealInput
            ? `${rescheduleMealInput}  ▼`
            : '請選擇餐次 ▼'}
        </Text>
      </TouchableOpacity>

      {/* 展開後，用一排過的選項；包含目前選中的餐次，所以可以點返早餐 */}
      {rescheduleMealOptionsVisible && (
        <View style={styles.mealOptionWrap}>
          {MEAL_OPTIONS.map(meal => {
            const isSelected = rescheduleMealInput === meal;

            return (
              <TouchableOpacity
                key={meal}
                style={[
                  styles.mealOptionChip,
                  isSelected && styles.mealOptionChipSelected
                ]}
                onPress={() => {
                  setRescheduleMealInput(meal);
                  setRescheduleMealOptionsVisible(false);
                }}
              >
                <Text
                  style={[
                    styles.mealOptionChipText,
                    isSelected && styles.mealOptionChipTextSelected
                  ]}
                >
                  {isSelected ? '✅ ' : ''}
                  {meal}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      <Text style={styles.label}>給發起人的訊息，可留空：</Text>
      <TextInput
        style={styles.input}
        value={rescheduleReasonInput}
        onChangeText={setRescheduleReasonInput}
        placeholder="例如：當日太忙，改到週末比較方便"
        placeholderTextColor="#B8A89A"
      />

      <Text style={styles.modalHintText}>
        如果不填，系統會自動傳送 official 通知。
      </Text>

      <View style={styles.modalButtonRow}>
        <Button
          title="取消"
          color="gray"
          disabled={isRescheduleSubmitting}
          onPress={() => {
            setRescheduleModalVisible(false);
            setRescheduleTargetId(null);
            setRescheduleDateInput('');
            setRescheduleMealInput('');
            setRescheduleMealOptionsVisible(false);
            setRescheduleReasonInput('');
            setIsRescheduleSubmitting(false);
          }}
        />

        <Button
          title={isRescheduleSubmitting ? '處理中...' : '確認改期'}
          color="#28a745"
          disabled={isRescheduleSubmitting}
          onPress={handleConfirmReschedule}
        />
      </View>
    </View>
  </View>
</Modal>


{/* 拒絕 / 取消訊息 Modal */}
<Modal
  animationType="slide"
  transparent={true}
  visible={rejectModalVisible}
  onRequestClose={() => {
    setRejectModalVisible(false);
    setRejectTargetRequest(null);
    setRejectReasonInput('');
  }}
>
  <View style={styles.modalCentered}>
    <View style={styles.modalView}>
      <Text style={styles.modalTitle}>📝 拒絕 / 取消訊息</Text>

      <Text style={styles.label}>給發起人的訊息，可留空：</Text>
      <TextInput
        style={styles.input}
        value={rejectReasonInput}
        onChangeText={setRejectReasonInput}
        placeholder="例如：當日沒有時間煮 / 材料不足"
        placeholderTextColor="#B8A89A"
      />
{isRejectTargetFruit() && (
  <View style={styles.tagContainer}>
    {FRUIT_REJECT_REASONS.map(reason => (
      <TouchableOpacity
        key={reason}
        style={[
          styles.miniSelectBtn,
          rejectReasonInput === reason && styles.miniSelectBtnActive
        ]}
        onPress={() => setRejectReasonInput(reason)}
      >
        <Text
          style={[
            styles.miniSelectBtnText,
            rejectReasonInput === reason && styles.miniSelectBtnTextActive
          ]}
        >
          {reason}
        </Text>
      </TouchableOpacity>
    ))}
  </View>
)}

      <View style={styles.modalButtonRow}>
        <Button
          title="取消"
          color="gray"
          onPress={() => {
            setRejectModalVisible(false);
            setRejectTargetRequest(null);
            setRejectReasonInput('');
          }}
        />

        <Button
          title="確認"
          color="#dc3545"
          onPress={handleConfirmRejectRequest}
        />
      </View>
    </View>
  </View>
</Modal>

{/* 刪除帳號前重新驗證 Modal */}
<Modal
  animationType="slide"
  transparent={true}
  visible={deleteAccountModalVisible}
  onRequestClose={() => {
    if (isDeletingAccount) return;
    setDeleteAccountModalVisible(false);
    setDeleteAccountPasswordInput('');
  }}
>
  <View style={styles.modalCentered}>
    <View style={styles.modalView}>
      <Text style={styles.modalTitle}>⚠️ 真的要刪除帳號嗎？</Text>

      <Text style={styles.label}>重新輸入密碼：</Text>

      <TextInput
        style={styles.input}
        value={deleteAccountPasswordInput}
        onChangeText={setDeleteAccountPasswordInput}
        placeholderTextColor="#B8A89A"
        secureTextEntry
      />

      <Text style={styles.modalDangerHintText}>
        警告：被刪除帳號無法復原。
      </Text>

      <View style={styles.modalButtonRow}>
        <Button
          title="取消"
          color="gray"
          disabled={isDeletingAccount}
          onPress={() => {
            setDeleteAccountModalVisible(false);
            setDeleteAccountPasswordInput('');
          }}
        />

        <Button
          title={isDeletingAccount ? '刪除中...' : '確認刪除'}
          color="#dc3545"
          disabled={isDeletingAccount}
          onPress={handleConfirmDeleteMyAccount}
        />
      </View>
    </View>
  </View>
</Modal>


{/* ================= 底部導覽列 (TabBar) ================= */}
<View
  style={[
    styles.tabBar,
    {
      paddingBottom: Math.max(insets.bottom, 12),
      minHeight: 64 + Math.max(insets.bottom, 12)
    }
  ]}
>
  <TouchableOpacity
    style={[
      styles.tabItem,
      currentTab === 'home' && styles.tabItemActive
    ]}
    onPress={() => {
      setCustomModalVisible(false);
      setRequestModalVisible(false);
      setRescheduleModalVisible(false);
      setCurrentTab('home');
      setFruitRequestModalVisible(false);
setHiddenFruitsModalVisible(false);
    }}
  >
    <Text style={styles.tabIcon}>🏠</Text>
    <Text
      style={[
        styles.tabText,
        currentTab === 'home' && styles.tabTextActive
      ]}
    >
      點菜區
    </Text>
  </TouchableOpacity>

  <TouchableOpacity
    style={[
      styles.tabItem,
      currentTab === 'group' && styles.tabItemActive
    ]}
    onPress={() => {
      setCustomModalVisible(false);
      setRequestModalVisible(false);
      setRescheduleModalVisible(false);
      setCurrentTab('group');
    }}
  >
    <Text style={styles.tabIcon}>📅</Text>
    <Text
      style={[
        styles.tabText,
        currentTab === 'group' && styles.tabTextActive
      ]}
    >
      排餐記錄
    </Text>
  </TouchableOpacity>

  <TouchableOpacity
    style={[
      styles.tabItem,
      currentTab === 'add' && styles.tabItemActive
    ]}
    onPress={() => {
      setCustomModalVisible(false);
      setRequestModalVisible(false);
      setRescheduleModalVisible(false);
      setCurrentTab('add');
    }}
  >
    <Text style={styles.tabIcon}>🔔</Text>
    <Text
      style={[
        styles.tabText,
        currentTab === 'add' && styles.tabTextActive
      ]}
    >
      通知
    </Text>
  </TouchableOpacity>

  <TouchableOpacity
    style={[
      styles.tabItem,
      currentTab === 'shopping' && styles.tabItemActive
    ]}
    onPress={() => {
      setCustomModalVisible(false);
      setRequestModalVisible(false);
      setRescheduleModalVisible(false);
      setCurrentTab('shopping');
    }}
  >
    <Text style={styles.tabIcon}>🛒</Text>
    <Text
      style={[
        styles.tabText,
        currentTab === 'shopping' && styles.tabTextActive
      ]}
    >
      採買清單
    </Text>
  </TouchableOpacity>

  <TouchableOpacity
    style={[
      styles.tabItem,
      currentTab === 'profile' && styles.tabItemActive
    ]}
    onPress={() => {
      setCustomModalVisible(false);
      setRequestModalVisible(false);
      setRescheduleModalVisible(false);
      setCurrentTab('profile');
    }}
  >
    <Text style={styles.tabIcon}>👤</Text>
    <Text
      style={[
        styles.tabText,
        currentTab === 'profile' && styles.tabTextActive
      ]}
    >
      設定
    </Text>
  </TouchableOpacity>
</View>

    </View>
      </SafeAreaView>
  );
}
export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}

{/* ================= 樣式表 StyleSheet ================= */}

const styles = StyleSheet.create({
safeRoot: {  flex: 1,  backgroundColor: '#FFF8F0'},
  container: {    flex: 1,    backgroundColor: '#FFF8F0'  },
  content: {    flex: 1,    padding: 15,    backgroundColor: '#FFF8F0'  },
  pageContent: {    paddingBottom: 12  },
  authScreen: {    flex: 1,    backgroundColor: '#FFF8F0'  },
  authTitleArea: {    alignItems: 'center',    marginBottom: 18  },
header: {  backgroundColor: '#FF8A65',  paddingHorizontal: 14,  marginBottom: 12,  borderRadius: 14},
headerInner: {  paddingVertical: 8,  alignItems: 'center',  justifyContent: 'center'},
headerTitle: {  fontSize: 18,  fontWeight: 'bold',  color: '#fff',  textAlign: 'center'},
  sectionTitle: {    fontSize: 16,    fontWeight: 'bold',    color: '#4A3B32',    marginVertical: 10  },
  sectionTitleSmall: {    fontSize: 14,    fontWeight: 'bold',    color: '#5A4A42',    marginBottom: 10  },
  sectionTitleLarge: {    fontSize: 20,    fontWeight: 'bold',    color: '#4A3B32',    marginBottom: 16,    textAlign: 'center'  },
  sectionTitleBlock: {    fontSize: 16,    fontWeight: 'bold',    color: '#FF7043',    marginBottom: 12  },
  label: {    fontSize: 14,    fontWeight: 'bold',    color: '#5A4A42',    marginBottom: 6,    marginTop: 6  },
  searchSectionCard: {    backgroundColor: '#FFFFFF',    padding: 16,    borderRadius: 18,    marginBottom: 16,    borderWidth: 1,    borderColor: '#F4E5D8',    shadowColor: '#000',    shadowOpacity: 0.05,    shadowRadius: 8,    shadowOffset: { width: 0, height: 3 },elevation: 2  },
  formCard: {    backgroundColor: '#FFFFFF',    padding: 18,    borderRadius: 18,    marginBottom: 16,    borderWidth: 1,    borderColor: '#F4E5D8',    shadowColor: '#000',    shadowOpacity: 0.05,    shadowRadius: 8,    shadowOffset: { width: 0, height: 3 },elevation: 2  },
  setupCard: {    backgroundColor: '#FFFFFF',    padding: 16,    borderRadius: 18,    marginBottom: 16,    borderWidth: 1,    borderColor: '#F4E5D8',    shadowColor: '#000',    shadowOpacity: 0.04,    shadowRadius: 6,    shadowOffset: { width: 0, height: 2 }, elevation: 2  },
  cardTitle: {    fontSize: 15,    fontWeight: 'bold',    color: '#4A3B32',    marginBottom: 10  },
  input: {    backgroundColor: '#FFF7EC',    paddingHorizontal: 13,    paddingVertical: 11,    borderRadius: 12,    fontSize: 14,    marginBottom: 10,    color: '#3F332C',    borderWidth: 1,    borderColor: '#F2DDC8'  },
  infoActionButton: {    backgroundColor: '#3BB8B8'  },
  successActionButton: {    backgroundColor: '#58B368'  },
  dangerActionButton: {    backgroundColor: '#E85D75'  },
  neutralActionButton: {    backgroundColor: '#A89A8E'  },
  disabledActionButton: {    backgroundColor: '#D8CEC3'  },
  mainActionBtn: {    width: '100%',    paddingVertical: 15,    borderRadius: 14,    backgroundColor: '#3BB8B8',    alignItems: 'center',    marginTop: 12  },
  mainActionBtnAlt: {    width: '100%',    paddingVertical: 15,    borderRadius: 14,    backgroundColor: '#3BB8B8',    alignItems: 'center',    marginTop: 12  },
  mainActionText: {    color: '#fff',    fontSize: 16,    fontWeight: 'bold'  },
  switchStageLink: {    marginTop: 14,    alignItems: 'center'  },
  switchStageText: {    color: '#FF7043',    fontSize: 14,    fontWeight: '600'  },
switchToRegisterText: {  color: '#3BB8B8',  fontSize: 14,  textDecorationLine: 'underline'},
switchToLoginText: {  color: '#3BB8B8',  fontSize: 14,  textDecorationLine: 'underline'},
  primaryButton: {    backgroundColor: '#3BB8B8',    paddingVertical: 14,    borderRadius: 14,    alignItems: 'center',    marginTop: 8  },
  buttonText: {    color: '#fff',    fontSize: 15,    fontWeight: 'bold'  },
  luckyDrawButton: {    backgroundColor: '#d18de3',    paddingVertical: 15,    paddingHorizontal: 16,    borderRadius: 18,    alignItems: 'center',    justifyContent: 'center',    marginBottom: 16,    shadowColor: '#000',    shadowOpacity: 0.08,    shadowRadius: 8,    shadowOffset: { width: 0, height: 3 },  elevation: 3  },
  luckyDrawButtonText: {    color: '#fff',    fontSize: 16,    fontWeight: 'bold',    textAlign: 'center'  },
  toolbarRow: {    flexDirection: 'row',    justifyContent: 'space-between',    marginBottom: 12  },
  smallActionButton: {    flex: 1,    paddingVertical: 10,    paddingHorizontal: 10,    borderRadius: 12,    alignItems: 'center'  },
  smallActionButtonText: {    color: '#fff',    fontSize: 13,    fontWeight: 'bold'  },
  categoryBlock: {    borderBottomWidth: 1,    borderColor: '#F4E5D8',    paddingVertical: 9  },
  accordionHeader: {    flexDirection: 'row',    justifyContent: 'space-between',    alignItems: 'center'  },
  categoryLabel: {    fontSize: 14,    fontWeight: '700',    color: '#4A3B32'  },
  searchHintText: {    fontSize: 12,    color: '#9B8A7D'  },
  categoryContent: {    marginTop: 6  },
  subCategoryBlock: {    marginLeft: 10,    marginTop: 6  },
  subCategoryLabel: {    fontSize: 12,    color: '#7A6B60',    fontWeight: '600',    marginBottom: 4  },
  tagContainer: {    flexDirection: 'row',    flexWrap: 'wrap',    marginVertical: 6  },
  tagButtonBig: {    backgroundColor: '#FFF7EC',    paddingHorizontal: 12,    paddingVertical: 7,    borderRadius: 20,    marginRight: 8,    marginBottom: 8,    borderWidth: 1,    borderColor: '#F2DDC8'  },
  tagButtonSelected: {    backgroundColor: '#FF8A65',    borderColor: '#FF8A65'  },
  tagTextBig: {    fontSize: 12,    color: '#4A3B32'  },
  sectionHeaderRow: {    flexDirection: 'row',    justifyContent: 'space-between',    alignItems: 'center',    marginTop: 4,    marginBottom: 6  },
  editToggleButton: {    backgroundColor: '#FAAD14',    paddingVertical: 7,    paddingHorizontal: 12,    borderRadius: 12  },
  editToggleButtonActive: {    backgroundColor: '#58B368'  },
  editToggleButtonText: {    color: '#fff',    fontWeight: 'bold',    fontSize: 12  },
  editToolbar: {    backgroundColor: '#FFF7EC',    padding: 12,    borderRadius: 14,    marginBottom: 14,    borderWidth: 1,    borderColor: '#F2DDC8'  },
  editToolbarHint: {    fontSize: 12,    color: '#7A6B60',    marginBottom: 8  },
  editToolbarButtonGroup: {    marginTop: 4  },
  editToolbarRow: {    flexDirection: 'row'  },
  editMainActionButton: {    flex: 1,    padding: 10,    borderRadius: 12,    alignItems: 'center'  },
  editMainActionText: {    color: '#fff',    fontWeight: 'bold'  },
  clearSelectionButton: {    backgroundColor: '#A89A8E',    padding: 10,    borderRadius: 12,    alignItems: 'center',    minWidth: 80  },
  clearSelectionText: {    color: '#fff',    fontWeight: 'bold'  },
  hiddenManageButton: {    backgroundColor: '#9254DE',    padding: 10,    borderRadius: 12,    alignItems: 'center',    marginTop: 10  },
  hiddenManageButtonText: {    color: '#fff',    fontWeight: 'bold'  },
  dishCardSelectable: {    backgroundColor: '#FFFFFF',    padding: 15,    borderRadius: 18,    marginBottom: 12,    borderWidth: 1,    borderColor: '#F4E5D8',    shadowColor: '#000',    shadowOpacity: 0.04,    shadowRadius: 6,    shadowOffset: { width: 0, height: 2 },
    elevation: 2  },
  dishCardSelected: {    borderWidth: 2,    borderColor: '#3BB8B8',    backgroundColor: '#F0FDFA'  },
  dishCardRow: {    flexDirection: 'row',    alignItems: 'flex-start'  },
  dishCardContent: {    flex: 1  },
  dishCardHeader: {    flexDirection: 'row',    justifyContent: 'space-between',    alignItems: 'flex-start'  },
  dishName: {    fontSize: 16,    fontWeight: 'bold',    color: '#3F332C',    flexShrink: 1  },
  dishDetails: {    fontSize: 13,    color: '#6F6258',    marginTop: 6,    lineHeight: 19  },
  clickHint: {    fontSize: 12,    color: '#FF7043',    marginTop: 8,    fontWeight: 'bold'  },
  dishStatusText: {    fontSize: 11,    fontWeight: 'bold',    marginLeft: 8  },
  dishStatusApproved: {    color: '#58B368'  },
  dishStatusPending: {    color: '#FAAD14'  },
  dishStatusPrivate: {    color: '#1890FF'  },
  checkboxBox: {    width: 24,    height: 24,    borderRadius: 6,    borderWidth: 2,    borderColor: '#B8A89A',    backgroundColor: '#fff',    alignItems: 'center',    justifyContent: 'center',    marginRight: 10,    marginTop: 2  },
  checkboxBoxSelected: {    borderColor: '#3BB8B8',    backgroundColor: '#3BB8B8'  },
  checkboxTick: {    color: '#fff',    fontWeight: 'bold',    fontSize: 16,    lineHeight: 18  },
  monthSwitcherRow: {    flexDirection: 'row',    justifyContent: 'space-between',    alignItems: 'center',    marginBottom: 15  },
  switchMonthText: {    color: '#FF7043',    fontWeight: 'bold'  },
  monthTitle: {    fontSize: 16,    fontWeight: 'bold',    color: '#4A3B32'  },
  calendarContainer: {    backgroundColor: '#FFFFFF',    padding: 12,    borderRadius: 18,    marginBottom: 16,    borderWidth: 1,    borderColor: '#F4E5D8'  },
  calendarHeaderRow: {    flexDirection: 'row',    justifyContent: 'space-around',    marginBottom: 6  },
  calendarHeaderCell: {    fontSize: 14,    fontWeight: 'bold',    color: '#9B8A7D',    width: '14%',    textAlign: 'center'  },
  calendarGrid: {    flexDirection: 'row',    flexWrap: 'wrap'  },
  calendarCell: {    width: '14.28%',    height: 45,    justifyContent: 'center',    alignItems: 'center',    marginVertical: 2,    borderRadius: 10  },
  calendarCellEmpty: {    width: '14.28%',    height: 45  },
  calendarCellToday: {    backgroundColor: '#FFF0E8',    borderWidth: 1,    borderColor: '#FF8A65'  },
  calendarCellApproved: {    backgroundColor: '#58B368'  },
  calendarCellCompleted: {    backgroundColor: '#A89A8E'  },
  calendarCellPast: {    backgroundColor: '#EFE7DD',    opacity: 0.65  },
  calendarDayNum: {    fontSize: 14,    color: '#3F332C'  },
  calendarDayNumHasEvent: {    color: '#fff',    fontWeight: 'bold'  },
  calendarDayNumToday: {    color: '#FF7043',    fontWeight: 'bold'  },
  calendarDayNumPast: {    color: '#AAA'  },
  calendarDotWhite: {    width: 4,    height: 4,    borderRadius: 2,    backgroundColor: '#fff',    marginTop: 2  },
  requestCard: {    backgroundColor: '#FFFFFF',    padding: 15,    borderRadius: 18,    marginBottom: 12,    borderWidth: 1,    borderColor: '#F4E5D8'  },
  requestCardHeader: {    flexDirection: 'row',    justifyContent: 'space-between',    alignItems: 'center'  },
  requestMetaText: {    marginTop: 6,    color: '#4A3B32',    fontSize: 13  },
  requestMetaTextBottom: {    marginTop: 4,    marginBottom: 8,    color: '#4A3B32',    fontSize: 13  },
  requestMetaStrong: {    fontWeight: 'bold'  },
  statusBadge: {    paddingHorizontal: 8,    paddingVertical: 4,    borderRadius: 8,    fontSize: 12,    overflow: 'hidden',    fontWeight: 'bold'  },
  statusBadgeApproved: {    backgroundColor: '#EAF8EE',    color: '#58B368'  },
  statusBadgeRejected: {    backgroundColor: '#FFF1F0',    color: '#E85D75'  },
  statusBadgePending: {    backgroundColor: '#FFF7E6',    color: '#FA8C16'  },
  timeHighlight: {    color: '#FF7043',    fontWeight: 'bold'  },
  actionRow: {    flexDirection: 'row',    justifyContent: 'space-between',    marginTop: 10  },
  actionBtn: {    flex: 1,    padding: 8,    borderRadius: 10,    alignItems: 'center',    marginHorizontal: 3  },
  actionBtnText: {    color: '#fff',    fontWeight: 'bold',    fontSize: 13  },
  recommendBox: {    backgroundColor: '#FFF1F0',    padding: 10,    borderRadius: 12,    marginBottom: 10,    borderWidth: 1,    borderColor: '#FFD6D0'  },
  recommendWarningText: {    color: '#E85D75',    fontSize: 12,    fontWeight: 'bold'  },
  recommendItemText: {    fontSize: 12,    color: '#6F6258',    marginTop: 2  },
  formSectionHeaderRow: {    flexDirection: 'row',    justifyContent: 'space-between',    alignItems: 'center',    marginTop: 8,    marginBottom: 6  },
  inlineManageButton: {    backgroundColor: '#3BB8B8',    paddingVertical: 7,    paddingHorizontal: 10,    borderRadius: 10  },
  inlineManageButtonText: {    color: '#fff',    fontSize: 12,    fontWeight: 'bold'  },
  addCategoryBlock: {    marginBottom: 8  },
  addSubCategoryBlock: {    marginLeft: 10,    marginBottom: 5  },
  miniCategoryLabel: {    fontSize: 11,    color: '#9B8A7D',    fontWeight: 'bold'  },
  miniSelectBtn: {    backgroundColor: '#FFF7EC',    paddingHorizontal: 10,    paddingVertical: 6,    borderRadius: 14,    marginRight: 6,    marginBottom: 6,    borderWidth: 1,    borderColor: '#F2DDC8'  },
  miniSelectBtnActive: {    backgroundColor: '#FF8A65',    borderColor: '#FF8A65'  },
  miniSelectBtnText: {    fontSize: 11,    color: '#4A3B32'  },
  miniSelectBtnTextActive: {    color: '#fff',    fontWeight: 'bold'  },
  permissionRow: {    flexDirection: 'row',    justifyContent: 'space-between'  },
  permissionRowSpaced: {    flexDirection: 'row',    justifyContent: 'space-between',    marginBottom: 15  },
  permBtn: {    flex: 1,    padding: 10,    borderWidth: 1,    borderColor: '#F2DDC8',    borderRadius: 12,    alignItems: 'center',    marginHorizontal: 5,    backgroundColor: '#FFF7EC'  },
  permBtnActive: {    borderColor: '#FF8A65',    backgroundColor: '#FFF0E8'  },
  permBtnText: {    fontSize: 13,    color: '#4A3B32',    fontWeight: '600'  },
  shoppingInputRow: {    flexDirection: 'row',    marginBottom: 10  },
  shoppingInput: {    flex: 1,    marginBottom: 0  },
  confirmBtnReal: {    backgroundColor: '#3BB8B8',    justifyContent: 'center',    paddingHorizontal: 15,    borderRadius: 12,    marginLeft: 6  },
  confirmBtnRealText: {    color: '#fff',    fontWeight: 'bold'  },
  emptyShoppingText: {    textAlign: 'center',    color: '#9B8A7D',    marginVertical: 20  },
  shoppingItemRow: {    flexDirection: 'row',    justifyContent: 'space-between',    paddingVertical: 12,    borderBottomWidth: 1,    borderColor: '#F4E5D8',    alignItems: 'center'  },
  shoppingItemMain: {    flex: 1  },
  shoppingItemText: {    color: '#3F332C',    fontSize: 14  },
  shoppingItemTextChecked: {    textDecorationLine: 'line-through',    color: '#9B8A7D'  },
  shoppingDeleteButton: {    paddingLeft: 10  },
  shoppingDeleteText: {    color: '#58B368',    fontSize: 16  },
  profileText: {    fontSize: 15,    marginVertical: 6,    color: '#3F332C'  },
  profileHighlightText: {    fontWeight: 'bold',    color: '#FF7043'  },
  profileStrongText: {    fontWeight: 'bold',    color: '#3F332C'  },
  profileEditButton: {    backgroundColor: '#3BB8B8',    paddingVertical: 14,    borderRadius: 14,    alignItems: 'center',    marginTop: 8  },
  profileEditButtonText: {    color: '#fff',    fontWeight: 'bold'  },
  groupCodeText: {    fontSize: 12,    color: '#7A6B60',    marginBottom: 10  },
  memberInfoArea: {    flex: 1  },
  memberNameText: {    fontSize: 15,    fontWeight: '700',    color: '#3F332C'  },
  memberRoleText: {    fontSize: 12,    color: '#7A6B60',    marginTop: 2  },
  memberRoleCookText: {    color: '#58B368',    fontWeight: 'bold'  },
  memberGroupRoleText: {    fontSize: 12,    color: '#B8A89A',    fontStyle: 'italic',    marginBottom: 6  },
  memberAdminToggleOffButton: {    backgroundColor: '#F0F0F0',    borderColor: '#D9D9D9'  },
  memberAdminToggleOnButton: {    backgroundColor: '#E6FFFB',    borderColor: '#87E8DE'  },
  logoutButton: {    width: '100%',    paddingVertical: 15,    borderRadius: 14,    backgroundColor: '#E85D75',    alignItems: 'center',    marginTop: 12  },
  deleteAccountButton: {    width: '100%',    paddingVertical: 15,    borderRadius: 14,    backgroundColor: '#A89A8E',    alignItems: 'center',    marginTop: 12  },
  roleRow: {    flexDirection: 'row',    justifyContent: 'space-between'  },
  roleSelectBtn: {    flex: 1,    paddingVertical: 12,    borderRadius: 12,    borderWidth: 1,    borderColor: '#F2DDC8',    alignItems: 'center',    marginHorizontal: 5,    backgroundColor: '#FFF7EC'  },
  roleSelectBtnActive: {    borderColor: '#FF8A65',    backgroundColor: '#FFF0E8'  },
  roleBtnText: {    fontSize: 14,    fontWeight: '600',    color: '#4A3B32'  },
  modalCentered: {    flex: 1,    justifyContent: 'center',    alignItems: 'center',    backgroundColor: 'rgba(63, 51, 44, 0.45)'  },
  modalView: {    backgroundColor: '#FFFFFF',    borderRadius: 20,    padding: 20,    width: '86%',    maxHeight: '88%',    alignItems: 'center',    elevation: 5,    borderWidth: 1,    borderColor: '#F4E5D8'  },
  modalTitle: {    fontSize: 18,    fontWeight: 'bold',    marginBottom: 15,    color: '#3F332C',    textAlign: 'center'  },
  modalContentFull: {    width: '100%'  },
  modalStrongText: {    fontWeight: 'bold',    color: '#3F332C'  },
  modalDangerHintText: {    fontSize: 12,    color: '#E85D75',    marginTop: 6,    lineHeight: 18  },
  modalHintText: {    fontSize: 12,    color: '#9B8A7D',    marginTop: 4,    lineHeight: 18  },
  modalButtonRow: {    flexDirection: 'row',    justifyContent: 'space-between',    marginTop: 15,    width: '100%'  },
  modalBtn: {    flex: 1,    padding: 12,    borderRadius: 12,    alignItems: 'center',    marginHorizontal: 5  },
  modalBtnText: {    color: '#fff',    fontWeight: 'bold'  },
  modalCancelButton: {    backgroundColor: '#A89A8E'  },
  modalPrimaryButton: {    backgroundColor: '#FF8A65'  },
  modalFooterButtonArea: {    marginTop: 12,    width: '100%'  },
  emptyModalText: {    fontSize: 14,    color: '#7A6B60',    marginTop: 10,    textAlign: 'center'  },
  dropdownHeader: {    backgroundColor: '#FFF7EC',    padding: 11,    borderRadius: 12,    width: '100%',    marginBottom: 6,    borderWidth: 1,    borderColor: '#F2DDC8'  },
  dropdownHeaderText: {    fontSize: 14,    color: '#3F332C'  },
  dropdownPlaceholderText: {    color: '#9B8A7D'  },
  dropdownList: {    backgroundColor: '#fff',    borderWidth: 1,    borderColor: '#F4E5D8',    borderRadius: 12,    width: '100%',    marginBottom: 10,    overflow: 'hidden'  },
  dropdownItem: {    padding: 11,    borderBottomWidth: 1,    borderColor: '#F4E5D8'  },
  dropdownItemText: {    fontSize: 14,    color: '#3F332C'  },
  checkboxRow: {    flexDirection: 'row',    alignItems: 'center',    marginVertical: 15  },
  checkboxRowCompact: {    flexDirection: 'row',    alignItems: 'center',    marginTop: 4,    marginBottom: 4  },
  checkboxIcon: {    fontSize: 16  },
  checkboxLabel: {    marginLeft: 8,    fontSize: 14,    color: '#5A4A42',    flex: 1  },
  hiddenDishesModalView: {    backgroundColor: '#FFFFFF',    borderRadius: 20,    padding: 20,    width: '86%',    maxHeight: '85%',    alignItems: 'center',    borderWidth: 1,    borderColor: '#F4E5D8'  },
  hiddenDishesScroll: {    width: '100%',    maxHeight: 420  },
  hiddenDishCard: {    borderWidth: 1,    borderColor: '#D9F7BE',    backgroundColor: '#FCFFF5',    borderRadius: 14,    padding: 12,    marginBottom: 10  },
  restoreDishButton: {    backgroundColor: '#58B368',    padding: 9,    borderRadius: 12,    marginTop: 9,    alignItems: 'center'  },
  restoreDishButtonText: {    color: '#fff',    fontWeight: 'bold'  },
  requestInboxScroll: {    width: '100%',    maxHeight: 360  },
  requestInboxCard: {    borderWidth: 1,    borderColor: '#F4E5D8',    borderRadius: 14,    padding: 12,    marginBottom: 10,    backgroundColor: '#fff'  },
  requestInboxActionArea: {    marginTop: 10  },
  requestInboxActionButton: {    padding: 10,    borderRadius: 12,    marginBottom: 8,    alignItems: 'center'  },
  requestInboxActionText: {    color: '#fff',    fontWeight: 'bold'  },
  senderNotificationScroll: {    width: '100%',    maxHeight: 360  },
  senderNotificationCard: {    borderWidth: 1,    borderColor: '#FFE58F',    backgroundColor: '#FFFBE6',    borderRadius: 14,    padding: 12,    marginBottom: 10  },
  cookMessageText: {    fontSize: 13,    color: '#5A4A42',    marginTop: 12,    lineHeight: 22  },
  acknowledgeButton: {    backgroundColor: '#58B368',    padding: 9,    borderRadius: 12,    alignItems: 'center',    marginTop: 10  },
  acknowledgeButtonText: {    color: '#fff',    fontWeight: 'bold'  },
  mealOptionWrap: {    flexDirection: 'row',    flexWrap: 'wrap',    justifyContent: 'center',    alignItems: 'center',    marginBottom: 10  },
  mealOptionChip: {    backgroundColor: '#EFE7DD',    paddingVertical: 8,    paddingHorizontal: 12,    borderRadius: 12,    marginRight: 8,    marginBottom: 8  },
  mealOptionChipSelected: {    backgroundColor: '#3BB8B8'  },
  mealOptionChipText: {    color: '#4A3B32',    fontWeight: 'bold'  },
  mealOptionChipTextSelected: {    color: '#fff'  },
  bottomSheetOverlay: {    flex: 1,    backgroundColor: 'rgba(63, 51, 44, 0.45)',    justifyContent: 'flex-end'  },
  bottomSheetContainer: {    backgroundColor: '#FFFFFF',    borderTopLeftRadius: 24,    borderTopRightRadius: 24,    padding: 20,    maxHeight: '86%',    borderWidth: 1,    borderColor: '#F4E5D8'  },
  bottomSheetHeader: {    flexDirection: 'row',    justifyContent: 'space-between',    alignItems: 'center',    marginBottom: 18,    borderBottomWidth: 1,    borderColor: '#F4E5D8',    paddingBottom: 10  },
  bottomSheetTitle: {    fontSize: 18,    fontWeight: 'bold',    color: '#3F332C'  },
  bottomSheetCloseButton: {    padding: 5  },
  bottomSheetCloseText: {    fontSize: 20,    color: '#9B8A7D',    fontWeight: 'bold'  },
  bottomSheetScroll: {    width: '100%'  },
  tagManagerSection: {    marginBottom: 20,    padding: 12,    backgroundColor: '#FFF8F0',    borderRadius: 14,    borderWidth: 1,    borderColor: '#F4E5D8'  },
  tagManagerSectionTitlePink: {    fontSize: 14,    fontWeight: 'bold',    color: '#E85D75',    marginBottom: 8  },
  modalCategoryPickerArea: {    marginTop: 12  },
  modalSmallHintText: {    fontSize: 12,    color: '#6F6258',    marginBottom: 8  },
  modalCategoryChipWrap: {    flexDirection: 'row',    flexWrap: 'wrap'  },
  modalCategoryChip: {    paddingHorizontal: 10,    paddingVertical: 6,    borderWidth: 1,    borderColor: '#F2DDC8',    borderRadius: 10,    marginRight: 8,    marginBottom: 8,    backgroundColor: '#fff'  },
  modalCategoryChipSelected: {    backgroundColor: '#E85D75',    borderColor: '#E85D75'  },
  modalCategoryChipText: {    fontSize: 12,    color: '#4A3B32'  },
  modalCategoryChipTextSelected: {    color: '#fff',    fontWeight: 'bold'  },
moreCategoryToggleButton: {  paddingHorizontal: 12,  paddingVertical: 7,  backgroundColor: '#D99A5C',  borderRadius: 18,  marginRight: 8,  marginBottom: 8,  alignItems: 'center',  justifyContent: 'center'},
moreCategoryToggleText: {  fontSize: 12,  color: '#fff',  fontWeight: 'bold'},
  modalSubCategoryBox: {    marginTop: 8,    padding: 8,    backgroundColor: '#fff',    borderRadius: 12,    borderWidth: 1,    borderColor: '#F4E5D8'  },
  modalSubCategoryHint: {    fontSize: 11,    color: '#8C7C70',    marginBottom: 6  },
  modalSubCategoryChip: {    paddingHorizontal: 8,    paddingVertical: 5,    borderWidth: 1,    borderColor: '#F2DDC8',    borderRadius: 8,    marginRight: 6,    marginBottom: 6,    backgroundColor: '#FFF7EC'  },
  modalSubCategoryChipSelected: {    backgroundColor: '#FA8C16',    borderColor: '#FA8C16'  },
  modalSubCategoryChipText: {    fontSize: 11,    color: '#6F6258'  },
  modalSubCategoryChipTextSelected: {    color: '#fff',    fontWeight: 'bold'  },
bottomSheetCancelButton: {  flex: 1,  backgroundColor: '#A89A8E',  padding: 12,  borderRadius: 14,  alignItems: 'center',  marginRight: 10},
bottomSheetCancelButtonText: {  color: '#fff',  fontWeight: 'bold',  fontSize: 14},
  modalSaveButton: {    flex: 2,    backgroundColor: '#58B368',    padding: 12,    borderRadius: 14,    alignItems: 'center'  },
  modalSaveButtonText: {    color: '#fff',    fontWeight: 'bold',    fontSize: 15  },
  customEditSection: {    marginTop: 8,    marginBottom: 20,    borderTopWidth: 1,    borderTopColor: '#F4E5D8',    paddingTop: 12  },
  customEditToggleButton: {    backgroundColor: '#FAAD14',    padding: 10,    borderRadius: 12,    alignItems: 'center',    marginBottom: 10  },
  customEditToggleButtonActive: {    backgroundColor: '#9254DE'  },
  customEditToggleText: {    color: '#fff',    fontWeight: 'bold'  },
  customCategoryTitle: {    fontSize: 14,    fontWeight: 'bold',    color: '#13A8A8',    marginTop: 8,    marginBottom: 6  },
  customTagTitle: {    fontSize: 14,    fontWeight: 'bold',    color: '#E85D75',    marginTop: 14,    marginBottom: 6  },
  customEmptyText: {    fontSize: 13,    color: '#9B8A7D',    fontStyle: 'italic',    marginBottom: 8  },
  customManageRow: {    flexDirection: 'row',    justifyContent: 'space-between',    alignItems: 'center',    paddingVertical: 8,    borderBottomWidth: 1,    borderBottomColor: '#F4E5D8'  },
  customManageRowMain: {    flex: 1,    marginRight: 8  },
  customManageNameText: {    fontSize: 14,    fontWeight: 'bold',    color: '#3F332C'  },
  customManageMetaText: {    fontSize: 11,    color: '#7A6B60',    marginTop: 2  },
  customManageStateText: {    fontSize: 12,    color: '#9B8A7D'  },
  customManageStateTextSelected: {    color: '#E85D75',    fontWeight: 'bold'  },
  bulkDeleteButton: {    backgroundColor: '#E85D75',    padding: 10,    borderRadius: 12,    alignItems: 'center',    marginTop: 14  },
  bulkDeleteButtonDisabled: {    backgroundColor: '#D8CEC3'  },
  bulkDeleteButtonText: {    color: '#fff',    fontWeight: 'bold'  },
  finishEditButton: {    backgroundColor: '#58B368',    padding: 10,    borderRadius: 12,    alignItems: 'center',    marginTop: 10  },
  finishEditButtonText: {    color: '#fff',    fontWeight: 'bold'  },
  tabBar: {    position: 'absolute',    left: 0,    right: 0,    bottom: 0,    flexDirection: 'row',    backgroundColor: '#FFFFFF',    borderTopWidth: 1,    borderTopColor: '#F4E5D8',    paddingTop: 6,    elevation: 12,    shadowColor: '#000',    shadowOpacity: 0.08,    shadowRadius: 6,    shadowOffset: { width: 0, height: -2 },
    zIndex: 999  },
  tabItem: {    flex: 1,    alignItems: 'center',    justifyContent: 'center',    paddingVertical: 4,    borderRadius: 12,    marginHorizontal: 2  },
  tabItemActive: {    backgroundColor: '#FFF0E8'  },
  tabIcon: {    fontSize: 20,    marginBottom: 2  },
  tabText: {    fontSize: 11,    color: '#7A6B60'  },
  tabTextActive: {    color: '#FF7043',    fontWeight: 'bold'  },
profileSectionHeaderRow: {  flexDirection: 'row',  justifyContent: 'space-between',  alignItems: 'center',  marginBottom: 8},
profileInfoBox: {  backgroundColor: '#FFF8F0',  borderWidth: 1,  borderColor: '#F4E5D8',  borderRadius: 14,  padding: 12,  marginBottom: 12},
profileEditButtonRow: {  flexDirection: 'row',  marginTop: 14},
profileCancelButton: {  flex: 1,  backgroundColor: '#A89A8E',  paddingVertical: 12,  borderRadius: 14,  alignItems: 'center',  marginRight: 8},
profileCancelButtonText: {  color: '#fff',  fontWeight: 'bold'},
profileSaveButton: {  flex: 2,  backgroundColor: '#58B368',  paddingVertical: 12,  borderRadius: 14,  alignItems: 'center'},
profileSaveButtonText: {  color: '#fff',  fontWeight: 'bold'},
groupCodeCopyBox: {  backgroundColor: '#FFF7EC',  borderWidth: 1,  borderColor: '#F2DDC8',  borderRadius: 14,  padding: 12,  marginBottom: 12},
memberManageToggleButton: {  backgroundColor: '#FAAD14',  paddingVertical: 7,  paddingHorizontal: 12,  borderRadius: 12},
memberManageToggleButtonActive: {  backgroundColor: '#58B368'},
memberManageToggleButtonText: {  color: '#fff',  fontSize: 12,  fontWeight: 'bold'},
memberCard: {  backgroundColor: '#FFF8F0',  borderWidth: 1,  borderColor: '#F4E5D8',  borderRadius: 14,  padding: 12,  marginBottom: 10},
memberTopRow: {  flexDirection: 'row',  justifyContent: 'space-between',  alignItems: 'flex-start'},
memberButtonRow: {  flexDirection: 'row',  marginTop: 10},
memberSmallButton: {  flex: 1,  paddingVertical: 8,  borderRadius: 12,  alignItems: 'center',  marginRight: 8,  borderWidth: 1},
memberSmallButtonText: {  fontSize: 12,  fontWeight: 'bold',  color: '#3F332C'},
memberRemoveButton: {  backgroundColor: '#FFF1F0',  borderColor: '#FFD6D0',  marginRight: 0},
memberRemoveButtonText: {  fontSize: 12,  fontWeight: 'bold',  color: '#E85D75'},
scrollTopButton: {  position: 'absolute',  bottom: 120,  right: 20,  backgroundColor: '#FF8C42',  width: 48,  height: 48,  borderRadius: 24,  justifyContent: 'center',  alignItems: 'center',  elevation: 5},
scrollTopText: {  color: '#fff',  fontSize: 18,  fontWeight: 'bold'},
subTabContainer: {  flexDirection: 'row',  backgroundColor: '#FFF3E8',  borderRadius: 999,  padding: 4,  marginBottom: 14,  borderWidth: 1,  borderColor: '#F3D2B8',},
subTabButton: {  flex: 1,  paddingVertical: 8,  paddingHorizontal: 10,  borderRadius: 999,  alignItems: 'center',  justifyContent: 'center',},
subTabButtonActive: {  backgroundColor: '#FFFFFF',  shadowColor: '#000',  shadowOpacity: 0.06,  shadowRadius: 4,  shadowOffset: { width: 0, height: 2 },  elevation: 2,},
subTabButtonText: {  fontSize: 14,  fontWeight: '600',  color: '#A66A3F',},
subTabButtonTextActive: { color: '#E86A1C', fontWeight: '800' },
requestInboxBigButton: { backgroundColor: '#FF7A45', borderRadius: 18, paddingVertical: 16, paddingHorizontal: 16, marginBottom: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.18, shadowRadius: 5, elevation: 4 },
requestInboxBigButtonLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
requestInboxBigIcon: { fontSize: 30, marginRight: 12 },
requestInboxBigTitle: { fontSize: 17, fontWeight: '800', color: '#FFFFFF' },
modalHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
modalCloseText: { fontSize: 22, fontWeight: '900', color: '#8A5A44', paddingHorizontal: 8 },
addRecipeFullButton: { width: '100%', backgroundColor: '#ebb36e', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 14, marginTop: 8, marginBottom: 12, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
addRecipeFullButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
bulkTagManageButton: { backgroundColor: '#D99A5C', padding: 10, borderRadius: 12, alignItems: 'center', marginTop: 10 },
bulkTagManageButtonText: { color: '#fff', fontWeight: 'bold' },
bulkRemoveTagSelected: { backgroundColor: '#E85D75', borderColor: '#E85D75' },
calendarCellSpecialNotice: { backgroundColor: '#7C9A6D', borderColor: '#5F7F52', borderWidth: 1 },
specialNoticeTypeGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginTop: 8, marginBottom: 12 },
specialNoticeTypeButton: { width: '48%', minHeight: 48, paddingVertical: 12, paddingHorizontal: 10, borderRadius: 14, borderWidth: 1, borderColor: '#D8C7B5', backgroundColor: '#FFFDF8', marginBottom: 10, alignItems: 'center', justifyContent: 'center' },
specialNoticeTypeButtonActive: { backgroundColor: '#8B6F47', borderColor: '#8B6F47' },
specialNoticeTypeText: { fontSize: 14, color: '#5C4631', fontWeight: '700', textAlign: 'center' },
specialNoticeTypeTextActive: { color: '#FFFFFF' },
modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', alignItems: 'center', padding: 18 },
modalCard: { width: '100%', maxHeight: '85%', backgroundColor: '#FFFDF8', borderRadius: 20, padding: 16 },
specialNoticeButtonGroup: { marginTop: 14, width: '100%' },
specialNoticeFullButton: { width: '100%', paddingVertical: 14, paddingHorizontal: 16, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
specialNoticeSubmitButton: { backgroundColor: '#8B6F47' },
specialNoticeSubmitButtonDisabled: { backgroundColor: '#CFC7BE', opacity: 0.65 },
specialNoticeBackButton: { backgroundColor: '#F2E7DA', borderWidth: 1, borderColor: '#D8C7B5' },
specialNoticePrimaryButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800', textAlign: 'center' },
specialNoticeBackButtonText: { color: '#6B4F35', fontSize: 16, fontWeight: '800', textAlign: 'center' }
});
