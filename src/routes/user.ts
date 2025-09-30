import { Router, Request, Response } from "express";
import User from "../models/User.js";

const router = Router();

// ➕ Create user
router.post("/", async (req: Request, res: Response) => {
  try {
    if (!req.body) {
      return res.status(400).json({
        success: false,
        error: "Request body is empty",
      });
    }

    const { username, url } = req.body;
    if (!username || !url) {
      return res.status(400).json({
        success: false,
        error: "Username and url are required",
      });
    }

    const user = new User({ username, url });
    await user.save();

    return res.status(201).json({
      success: true,
      data: {
        id: user._id,
        username,
        url
      },
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: "Failed to create user",
      details: err instanceof Error ? err.message : err,
    });
  }
});

// 📋 Get all users
router.get("/", async (_req: Request, res: Response) => {
  try {
    const users = await User.find();

    if (!users?.length) {
      return res.status(200).json({
        success: true,
        data: [],
        message: "No users found",
      });
    }

    // Transform to DTO
    const usersResponse = users.map((u) => ({
      username: u.username,
      url: u.url,
      active: u.active,
      category: u.category,
    }));

    return res.status(200).json({
      success: true,
      data: usersResponse,
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      error: "Failed to fetch users",
      details: err,
    });
  }
});

// ➕ Create bulk users
router.post("/bulk", async (req: Request, res: Response) => {
    try {
        const usersArray = req.body;
   
        if (!Array.isArray(usersArray) || usersArray.length === 0) {
            return res.status(400).json({
                success: false,
                error: "Request body must be a non-empty array of users",
            });
        }

        const invalidUsers = usersArray.filter(
            (user) => !user.username || !user.url
        );
        if (invalidUsers.length > 0) {
            return res.status(400).json({
                success: false,
                error: "Each user object must have 'username' and 'url' fields",
            });
        }

        const result = await User.insertMany(usersArray);

        return res.status(201).json({
            success: true,
            data: result.map((user) => ({
                id: user._id,
                username: user.username,
                url: user.url,
                category: user.category,
            })),
        });
    } catch (err) {
        let errorMessage = "Failed to create users";
        if (err instanceof Error) {
            errorMessage = err.message;
        }
        return res.status(500).json({
            success: false,
            error: "Failed to create users",
            details: errorMessage,
        });
    }
});

// 🔍 Get user by ID
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const user = await User.findById(id);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    // DTO
    const { username, url, active, category } = user;
    const userResponse = { username, url, active, category };

    return res.status(200).json({
      success: true,
      data: userResponse,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: "Failed to fetch user",
      details: err instanceof Error ? err.message : err,
    });
  }
});



// ✏️ Update user
router.put("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updated = await User.findByIdAndUpdate(id, req.body, { new: true });

    if (!updated) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    // DTO 
    const { username, url, active, category } = updated;
    const userResponse = { username, url, active, category };

    return res.status(200).json({
      success: true,
      data: userResponse,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: "Failed to update user",
      details: err instanceof Error ? err.message : err,
    });
  }
});


// ❌ Delete user
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const deleted = await User.findByIdAndDelete(id);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    // DTO
    const { username, url, active, category } = deleted;
    const userDTO = { username, url, active, category };

    res.status(200).json({
      success: true,
      message: "User deleted successfully",
      data: userDTO,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: "Failed to delete user",
      details: err,
    });
  }
});
export default router;

